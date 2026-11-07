import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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
import { parseJsonc, publishedRoots, readTsconfigSources, staticPrefix } from './node-sources';

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

describe('parseJsonc (#899)', () => {
  it('readsCommentsAndTrailingCommas_leavingStringsAlone', () => {
    const text: string = [
      '\uFEFF/* header */',
      '{',
      '  // a comment',
      '  "include": ["src/**/*", "a//b",],',
      '}',
    ].join('\n');

    expect(parseJsonc(text)).toEqual({ include: ['src/**/*', 'a//b'] });
  });

  it('isNull_forWhatIsNotAnObject', () => {
    expect(parseJsonc('[1]')).toBeNull();
    expect(parseJsonc('{ nope')).toBeNull();
  });
});

describe('staticPrefix (#899)', () => {
  it('stopsAtTheFirstWildcard', () => {
    expect(staticPrefix('src/**/*.ts')).toBe('src');
    expect(staticPrefix('./lib/*.js')).toBe('lib');
    expect(staticPrefix('packages/a/src/**')).toBe('packages/a/src');
  });

  it('keepsAPlainPathWhole', () => {
    expect(staticPrefix('src/main.ts')).toBe('src/main.ts');
    expect(staticPrefix('dist/')).toBe('dist');
    expect(staticPrefix('/lib')).toBe('lib');
  });

  it('isEmpty_forAPatternThatStartsWithAWildcard', () => {
    expect(staticPrefix('**/*.ts')).toBe('');
    expect(staticPrefix('*.js')).toBe('');
  });
});

describe('publishedRoots (#899)', () => {
  it('readsEachEntry_droppingNegationsAndWildcards', () => {
    expect(publishedRoots(['lib/', 'index.js', '!lib/*.test.js', '*.d.ts', 3])).toEqual([
      'lib',
      'index.js',
    ]);
  });

  it('readsNothing_fromAFieldThatIsNotAList', () => {
    expect(publishedRoots(undefined)).toEqual([]);
    expect(publishedRoots('lib')).toEqual([]);
  });
});

describe('NodeProjectSystem declared sources (#899)', () => {
  let root: string = '';

  beforeEach(() => {
    root = realpathSync(mkdtempSync(path.join(tmpdir(), 'studio-node-')));
    write({
      'package.json': '{}',
      'index.html': '',
      'vite.config.ts': '',
      'pnpm-lock.yaml': '',
      'notes.txt': '',
      'run.log': '',
      'src/index.ts': '',
      'src/build/step.ts': '',
      'test/index.test.ts': '',
      'output/run.log': '',
      'public/logo.png': '',
      'dist/index.js': '',
      'lib/generated.js': '',
    });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  /**
   * Writes files under the fixture.
   * @param files The files' contents, by relative path.
   */
  function write(files: Readonly<Record<string, string>>): void {
    for (const [name, content] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
      writeFileSync(path.join(root, name), content);
    }
  }

  /**
   * Reads a contents tree as slash-joined paths, folders marked with a trailing slash.
   * @param nodes The tree.
   * @param prefix The path so far.
   * @returns Returns every node's path, depth-first.
   */
  function flat(nodes: readonly ProjectItemNode[], prefix: string = ''): string[] {
    return nodes.flatMap((node: ProjectItemNode): string[] =>
      node.type === 'folder'
        ? [`${prefix}${node.name}/`, ...flat(node.children, `${prefix}${node.name}/`)]
        : [`${prefix}${node.name}`],
    );
  }

  /**
   * Loads the fixture's contents, listed by {@link flat}.
   * @returns Returns the paths.
   */
  async function load(): Promise<string[]> {
    const items: ProjectItems | null = await new NodeProjectSystem().loadProjectItems(
      path.join(root, 'package.json'),
    );
    return flat(items!.tree);
  }

  it('listsWhatTheTsconfigCompiles_leavingTheRestToTheFileExplorer', async () => {
    write({
      'tsconfig.json': '{ "include": ["src/**/*"], "compilerOptions": { "outDir": "lib" } }',
    });

    expect(await load()).toEqual([
      'src/',
      'src/build/',
      'src/build/step.ts',
      'src/index.ts',
      'test/',
      'test/index.test.ts',
      'index.html',
      'package.json',
      'pnpm-lock.yaml',
      'tsconfig.json',
      'vite.config.ts',
    ]);
  });

  it('followsASolutionStyleConfiguration_throughItsReferences', async () => {
    write({
      'tsconfig.json': '{ "files": [], "references": [{ "path": "./tsconfig.app.json" }] }',
      'tsconfig.app.json': '{ "extends": "./tsconfig.base.json" }',
      'tsconfig.base.json': '{ "include": ["src"] }',
    });

    expect(await load()).toContain('src/index.ts');
    expect(await load()).not.toContain('output/run.log');
  });

  it('readsAPathInheritedFromAParentFolder_againstThatFolder', async () => {
    write({
      'packages/a/package.json': '{}',
      'packages/a/tsconfig.json': '{ "extends": "../../tsconfig.base.json" }',
      'tsconfig.base.json': '{ "include": ["packages/a/src"] }',
      'packages/a/src/a.ts': '',
      'packages/a/junk/x.log': '',
    });

    const items: ProjectItems | null = await new NodeProjectSystem().loadProjectItems(
      path.join(root, 'packages', 'a', 'package.json'),
    );

    expect(flat(items!.tree)).toEqual(['src/', 'src/a.ts', 'package.json', 'tsconfig.json']);
  });

  it('readsAnExtendsCycle_withoutHanging', async () => {
    write({
      'tsconfig.json': '{ "extends": "./tsconfig.other.json", "include": ["src"] }',
      'tsconfig.other.json': '{ "extends": "./tsconfig.json" }',
    });

    expect(await load()).toContain('src/index.ts');
  });

  it('listsThePublishedFiles_forAPackageWithNoTsconfig', async () => {
    write({ 'package.json': '{ "files": ["src", "dist", "run.log"] }' });

    const listed: string[] = await load();

    expect(listed).toEqual(expect.arrayContaining(['src/index.ts', 'run.log']));
    expect(listed).not.toContain('dist/');
  });

  it('dropsWhatIsPublishedFromTheOutputFolder', async () => {
    write({
      'package.json': '{ "files": ["lib"] }',
      'tsconfig.json': '{ "include": ["src"], "compilerOptions": { "outDir": "lib" } }',
    });

    expect(await load()).not.toContain('lib/generated.js');
  });

  it('leavesAWorkspacePackageToItsOwnNode', async () => {
    write({
      'tsconfig.json': '{ "include": ["src", "packages/a"] }',
      'packages/a/package.json': '{}',
      'packages/a/a.ts': '',
    });

    expect(await load()).not.toContain('packages/a/a.ts');
  });

  it('refusesAPathOutsideThePackage_andDoesNotFollowALinkOutOfIt', async () => {
    const outside: string = realpathSync(mkdtempSync(path.join(tmpdir(), 'studio-outside-')));
    writeFileSync(path.join(outside, 'secret.ts'), '');
    symlinkSync(outside, path.join(root, 'linked'));
    write({
      'tsconfig.json': `{ "include": ["src", "linked", "../${path.basename(outside)}", "${outside}"] }`,
    });

    const listed: string[] = await load();
    rmSync(outside, { recursive: true, force: true });

    expect(listed.some((entry: string): boolean => entry.includes('secret.ts'))).toBe(false);
    expect(listed).toContain('src/index.ts');
  });

  it.each([
    ['has neither', {}],
    ['has a tsconfig with no include', { 'tsconfig.json': '{}' }],
    ['compiles its whole folder', { 'tsconfig.json': '{ "include": ["**/*.ts", "src"] }' }],
    ['has a broken tsconfig', { 'tsconfig.json': '{ nope' }],
    ['declares what is not there', { 'tsconfig.json': '{ "include": ["gone"] }' }],
    ['only publishes outputs', { 'package.json': '{ "files": ["dist", "build/"] }' }],
  ])(
    'fallsBackToTheListing_whenThePackage %s',
    async (_name: string, files: Readonly<Record<string, string>>) => {
      write(files);

      expect(await load()).toEqual(expect.arrayContaining(['notes.txt', 'output/run.log']));
    },
  );

  it('readsNoConfigurationAsNoAnswer', async () => {
    expect(await readTsconfigSources(root)).toBeNull();
  });
});
