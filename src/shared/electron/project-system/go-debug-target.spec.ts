import { describe, expect, it } from 'vitest';
import type { DebugResolveResult } from '@shared/api/debug-channels';
import type { RunConfiguration } from '@shared/api/studio';
import { goDebugTarget } from './go-debug-target';

/**
 * The workspace every case debugs in.
 */
const ROOT: string = '/work/shapes';

/**
 * Builds a Go run configuration.
 * @param fields The fields to set.
 * @returns Returns the configuration.
 */
function configuration(fields: Partial<RunConfiguration>): RunConfiguration {
  return { id: 'go', name: 'Go', providerKind: 'go', mode: 'debug', ...fields };
}

describe('goDebugTarget (#1211)', () => {
  it('goRun_debugsThePackage_inDelvesDebugMode_withWhatFollowsItAsTheProgramsArgs', () => {
    expect(
      goDebugTarget(
        configuration({ program: 'go', args: ['run', './cmd/area', '--width', '3'] }),
        ROOT,
      ),
    ).toEqual({
      target: {
        program: '/work/shapes/cmd/area',
        args: ['--width', '3'],
        cwd: ROOT,
        env: {},
        launchExtras: { mode: 'debug' },
      },
      error: null,
    });
  });

  it('goRun_withBuildFlags_passesThemAsDelvesBuildFlags_notAsThePackage', () => {
    const resolved: DebugResolveResult = goDebugTarget(
      configuration({ program: 'go', args: ['run', '-tags', 'integration', '-race', '.'] }),
      ROOT,
    );

    expect(resolved.target).toMatchObject({
      program: ROOT,
      args: [],
      launchExtras: { mode: 'debug', buildFlags: '-tags integration -race' },
    });
  });

  it('goTest_debugsInTestMode_withTheTestFlagsSpeltAsTheTestBinaryReadsThem', () => {
    // Delve's test mode hands its args to the test binary, which reads `-test.run`, not `-run`.
    const resolved: DebugResolveResult = goDebugTarget(
      configuration({
        program: 'go',
        args: ['test', './shapes', '-run', '^TestArea$', '-v', '-count=1'],
      }),
      ROOT,
    );

    expect(resolved.target).toMatchObject({
      program: '/work/shapes/shapes',
      args: ['-test.run', '^TestArea$', '-test.v', '-test.count=1'],
      launchExtras: { mode: 'test' },
    });
  });

  it('aModuleImportPath_isLeftForDelveToResolve', () => {
    expect(
      goDebugTarget(configuration({ program: 'go', args: ['run', 'example.com/shapes/cmd'] }), ROOT)
        .target?.program,
    ).toBe('example.com/shapes/cmd');
  });

  it('noProgramNamed_debugsThePackageInTheConfigurationsFolder', () => {
    expect(goDebugTarget(configuration({ cwd: 'cmd/area' }), ROOT).target).toMatchObject({
      program: '/work/shapes/cmd/area',
      cwd: '/work/shapes/cmd/area',
      launchExtras: { mode: 'debug' },
    });
  });

  it('aBuiltProgram_runsInExecMode', () => {
    expect(
      goDebugTarget(configuration({ program: 'bin/area', args: ['3', '4'] }), ROOT).target,
    ).toMatchObject({
      program: '/work/shapes/bin/area',
      args: ['3', '4'],
      launchExtras: { mode: 'exec' },
    });
  });

  it.each([
    ['a folder outside the workspace', configuration({ cwd: '../elsewhere' })],
    [
      'a package outside the workspace',
      configuration({ program: 'go', args: ['run', '../../evil'] }),
    ],
    ['a program outside the workspace', configuration({ program: '/usr/bin/true' })],
  ])('refuses %s', (_label: string, refused: RunConfiguration) => {
    const resolved: DebugResolveResult = goDebugTarget(refused, ROOT);

    expect(resolved.target).toBeNull();
    expect(resolved.error).toMatch(/workspace/);
  });

  it('aGoCommandThatBuildsNothingToRun_isRefused_sayingWhich', () => {
    expect(goDebugTarget(configuration({ program: 'go', args: ['vet', './...'] }), ROOT)).toEqual({
      target: null,
      error: 'Only `go run` and `go test` build something to debug.',
    });
  });
});
