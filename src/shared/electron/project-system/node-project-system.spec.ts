import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { DebugResolveResult } from '@shared/api/debug-channels';
import { RunConfiguration } from '@shared/api/studio';
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
