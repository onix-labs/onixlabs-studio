import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { DebugResolveResult } from '@shared/api/debug-channels';
import { RunConfiguration } from '@shared/api/studio';
import type { ProjectItemNode, ProjectItems, ProjectModel } from '@shared/api/project-system';
import {
  NodeCommand,
  NodeProjectSystem,
  parseManifestActions,
  splitNodeCommand,
} from './node-project-system';

describe('parseManifestActions', () => {
  it('backsAnActionWithTheConventionalScriptOfTheSameName', () => {
    expect(parseManifestActions({ scripts: { build: 'tsc' } })).toEqual(['build']);
    expect(parseManifestActions({ scripts: { clean: 'rimraf dist' } })).toEqual(['clean']);
    expect(parseManifestActions({ scripts: { test: 'vitest' } })).toEqual(['test']);
  });

  it('declaresTheBackedActionsInAStableOrder', () => {
    // Authoring order in the manifest must not leak into the declared capabilities.
    const manifest: Record<string, unknown> = {
      scripts: { test: 'vitest', clean: 'rimraf dist', build: 'tsc' },
    };
    expect(parseManifestActions(manifest)).toEqual(['build', 'clean', 'test']);
  });

  it('backsNothingFromAScriptThatMerelyLooksBuildShaped', () => {
    // `npm run build` is what the Build button dispatches: declaring the action from `build:prod`
    // would light a button that runs nothing.
    expect(
      parseManifestActions({ scripts: { 'build:prod': 'tsc -p prod', prebuild: 'x' } }),
    ).toEqual([]);
  });

  it('backsNothingWithoutUsableScripts', () => {
    expect(parseManifestActions(null)).toEqual([]);
    expect(parseManifestActions({})).toEqual([]);
    expect(parseManifestActions({ scripts: {} })).toEqual([]);
    expect(parseManifestActions({ scripts: 'build' })).toEqual([]);
    expect(parseManifestActions({ scripts: null })).toEqual([]);
  });
});

describe('NodeProjectSystem', () => {
  const provider: NodeProjectSystem = new NodeProjectSystem();

  it('declaresTheNodeKindWithNoBuildConfigOrTargetAxis', () => {
    expect(provider.kind).toBe('node');
    // The baseline: an interpreted ecosystem, so no build-configuration or target axis, and the
    // actions of a loaded root come from its own manifest rather than from this list.
    expect(provider.capabilities.actions).toEqual([]);
    expect(provider.capabilities.buildConfigurations).toEqual([]);
    expect(provider.capabilities.target).toBeNull();
    expect(provider.capabilities.debug).toEqual({ adapter: 'js-debug' });
  });

  it('ownsPackageManifestsOnly', () => {
    expect(provider.ownsProject('/w/package.json')).toBe(true);
    expect(provider.ownsProject('/w/package-lock.json')).toBe(false);
    expect(provider.ownsProject('/w/tsconfig.json')).toBe(false);
  });
});

describe('splitNodeCommand (#882)', () => {
  it('readsANodeCommandLine_asRuntimeFlagsScriptAndItsArguments_droppingTheInspector', () => {
    const command: NodeCommand = splitNodeCommand('node', [
      '--inspect=9229',
      '--enable-source-maps',
      '-r',
      'dotenv/config',
      'src/main.ts',
      '--port',
      '3000',
    ]);

    expect(command).toEqual({
      runtime: 'node',
      runtimeArgs: ['--enable-source-maps', '-r', 'dotenv/config'],
      script: 'src/main.ts',
      scriptArgs: ['--port', '3000'],
    });
  });

  it('takesAProgramThatIsNotARuntime_asTheScriptItself', () => {
    expect(splitNodeCommand('dist/server.js', ['--port', '3000'])).toEqual({
      runtimeArgs: [],
      script: 'dist/server.js',
      scriptArgs: ['--port', '3000'],
    });
  });

  it('knowsTheRuntimeByItsName_whereverItLives', () => {
    expect(splitNodeCommand('/usr/local/bin/node', ['app.js']).runtime).toBe('/usr/local/bin/node');
    expect(splitNodeCommand('C:\\nodejs\\node.exe', ['app.js']).script).toBe('app.js');
  });

  it('namesNoScript_whenTheRuntimeIsGivenNone', () => {
    expect(splitNodeCommand('node', ['--inspect']).script).toBeUndefined();
    expect(splitNodeCommand(undefined, []).script).toBeUndefined();
  });
});

describe('NodeProjectSystem.resolveDebugTarget (#882)', () => {
  let root: string;
  const provider: NodeProjectSystem = new NodeProjectSystem();

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'studio-node-debug-'));
    writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'demo' }));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  /**
   * Builds a Debug configuration.
   * @param program The program.
   * @param args The arguments.
   * @returns Returns the configuration.
   */
  function config(program: string, args: readonly string[]): RunConfiguration {
    return { id: 'main', name: 'Main', providerKind: 'node', mode: 'debug', program, args };
  }

  it('debugsTheScriptAConfigurationRuns_withNodeAsTheRuntime', async () => {
    // `node --inspect=9229 src/main.ts` used to launch "<root>/node" — no such file — and exit at once.
    const result: DebugResolveResult = await provider.resolveDebugTarget(
      config('node', ['--inspect=9229', 'src/main.ts']),
      root,
    );

    expect(result.error).toBeNull();
    expect(result.target).toEqual({
      program: path.join(root, 'src', 'main.ts'),
      cwd: root,
      args: [],
      launchExtras: { runtimeExecutable: 'node', runtimeArgs: [] },
    });
  });

  it('refusesARuntimeWithNoScript_sayingSo', async () => {
    const result: DebugResolveResult = await provider.resolveDebugTarget(config('node', []), root);

    expect(result.target).toBeNull();
    expect(result.error).toContain('without naming a script');
  });

  it('stillConfinesTheScript_toTheWorkspace', async () => {
    const result: DebugResolveResult = await provider.resolveDebugTarget(
      config('node', ['../outside.js']),
      root,
    );

    expect(result.target).toBeNull();
    expect(result.error).toBe('The program is outside the workspace.');
  });
});

const fixtures: string[] = [];

afterEach(() => {
  for (const root of fixtures.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

/**
 * Writes a tree of files under a new temporary directory.
 * @param files The files' contents, by relative path.
 * @returns Returns the directory.
 */
function fixture(files: Readonly<Record<string, string>>): string {
  const root: string = realpathSync(mkdtempSync(path.join(tmpdir(), 'studio-project-')));
  fixtures.push(root);
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    writeFileSync(path.join(root, name), content);
  }
  return root;
}

/**
 * Lists the paths of a project tree, folders first.
 * @param nodes The tree.
 * @returns Returns the names, indented by depth.
 */
function names(nodes: readonly ProjectItemNode[], depth: number = 0): string[] {
  return nodes.flatMap((node: ProjectItemNode): string[] => [
    `${' '.repeat(depth)}${node.name}`,
    ...(node.type === 'folder' ? names(node.children, depth + 1) : []),
  ]);
}

describe('NodeProjectSystem on disk', () => {
  const provider: NodeProjectSystem = new NodeProjectSystem();

  it.each<[string, string]>([
    ['truncatedJson', '{"name":'],
    ['anEmptyFile', ''],
    ['aBareString', '"name"'],
    ['null', 'null'],
  ])('doesNotDetectAManifestThatIs_%s', async (_name: string, content: string) => {
    expect(await provider.detect(fixture({ 'package.json': content }))).toBe(false);
    expect(await provider.load(fixture({ 'package.json': content }))).toBeNull();
  });

  it('readsAManifestWithAByteOrderMark', async () => {
    const root: string = fixture({ 'package.json': '\uFEFF{"name":"bom"}' });

    expect((await provider.load(root))?.projects[0].name).toBe('bom');
  });

  it.each<[string, string]>([
    ['noName', '{}'],
    ['aBlankName', '{"name":"  "}'],
    ['aNonStringName', '{"name":3}'],
  ])('namesAPackageWith_%s_afterItsFolder', async (_name: string, content: string) => {
    const root: string = fixture({ 'package.json': content });

    expect((await provider.load(root))?.projects[0].name).toBe(path.basename(root));
  });

  it('declaresOnlyTheActionsTheManifestBacks', async () => {
    const root: string = fixture({ 'package.json': '{"scripts":{"build":"tsc"}}' });

    expect((await provider.load(root))?.capabilities.actions).toEqual(['build']);
  });

  it('expandsWorkspaces_skippingWhatHoldsNoManifest_andDuplicates', async () => {
    const root: string = fixture({
      'package.json': '{"name":"mono","workspaces":["packages/*","packages/a","gone/*","tools/x"]}',
      'packages/a/package.json': '{"name":"a"}',
      'packages/b/package.json': 'not json',
      'packages/node_modules/package.json': '{"name":"skipped"}',
      'packages/.hidden/package.json': '{"name":"hidden"}',
      'tools/x/package.json': '{"name":"x"}',
    });

    const model: ProjectModel | null = await provider.load(root);

    expect(model?.projects.map((entry: { name: string }): string => entry.name)).toEqual([
      'mono',
      'a',
      'x',
    ]);
    expect(model?.solution?.name).toBe('mono');
  });

  it('listsAProjectsItems_leavingNestedPackagesToTheirOwnNodes', async () => {
    const root: string = fixture({
      'package.json': '{}',
      'src/index.ts': '',
      'src/nested/package.json': '{}',
      'src/nested/inner.ts': '',
      'node_modules/x/index.js': '',
    });

    const items: ProjectItems | null = await provider.loadProjectItems(
      path.join(root, 'package.json'),
    );

    expect(names(items?.tree ?? [])).toEqual(['src', ' index.ts', 'package.json']);
  });

  it('isNull_forItemsOfAProjectWhoseFolderHasGone', async () => {
    expect(await provider.loadProjectItems('/no/such/place/package.json')).toBeNull();
  });
});
