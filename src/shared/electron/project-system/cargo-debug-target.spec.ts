import { describe, expect, it } from 'vitest';
import { builtPrograms, cargoBuildErrors, cargoDebugBuild } from './cargo-debug-target';

/**
 * Writes a Cargo `compiler-artifact` message, as `--message-format=json` reports one.
 * @param executable The program built, or null for a library.
 * @param kinds The target's kinds.
 * @param test Whether it was built as a test harness.
 * @returns Returns the message's line.
 */
function artifact(executable: string | null, kinds: readonly string[], test: boolean): string {
  return JSON.stringify({
    reason: 'compiler-artifact',
    target: { kind: kinds, name: 'shapes' },
    profile: { test },
    executable,
  });
}

describe('cargo-debug-target (#1210)', () => {
  describe('cargoDebugBuild', () => {
    it('buildsATestWithoutRunningIt_andKeepsWhatComesAfterTheSeparatorForTheProgram', () => {
      // What rust-analyzer's Run Test lens gives for `tests::rectangle_area`.
      expect(
        cargoDebugBuild([
          'test',
          '--package',
          'shapes',
          '--lib',
          '--',
          'tests::rectangle_area',
          '--exact',
          '--nocapture',
        ]),
      ).toEqual({
        build: ['test', '--package', 'shapes', '--lib', '--no-run', '--message-format=json'],
        executableArgs: ['tests::rectangle_area', '--exact', '--nocapture'],
        test: true,
      });
    });

    it('buildsWhatARunWouldRun', () => {
      expect(cargoDebugBuild(['run', '--package', 'app', '--bin', 'app'])).toEqual({
        build: ['build', '--package', 'app', '--bin', 'app', '--message-format=json'],
        executableArgs: [],
        test: false,
      });
      expect(cargoDebugBuild(['bench', '--', 'fast'])?.build).toEqual([
        'bench',
        '--no-run',
        '--message-format=json',
      ]);
    });

    it('refusesWhatLeavesNoProgramBehind', () => {
      expect(cargoDebugBuild(['test', '--doc', '--package', 'shapes'])).toBeNull();
      expect(cargoDebugBuild(['check'])).toBeNull();
      expect(cargoDebugBuild([])).toBeNull();
    });
  });

  describe('builtPrograms', () => {
    const lines: string = [
      'Compiling shapes v0.1.0',
      artifact(null, ['lib'], false),
      artifact('/w/target/debug/deps/shapes-2579', ['lib'], true),
      artifact('/w/target/debug/app', ['bin'], false),
      artifact('/w/target/debug/deps/shapes-2579', ['lib'], true),
      JSON.stringify({ reason: 'build-finished', success: true }),
      '{ not json',
    ].join('\n');

    it('findsTheTestHarness_forATestBuild_once', () => {
      expect(builtPrograms(lines, true)).toEqual(['/w/target/debug/deps/shapes-2579']);
    });

    it('findsTheBinary_forARunBuild', () => {
      expect(builtPrograms(lines, false)).toEqual(['/w/target/debug/app']);
    });

    it('findsNothing_whenNothingRunnableWasBuilt', () => {
      expect(builtPrograms(artifact(null, ['lib'], false), true)).toEqual([]);
    });
  });

  it('cargoBuildErrors_readsTheCompilersOwnRenderingOfEachError', () => {
    const stdout: string = [
      JSON.stringify({
        reason: 'compiler-message',
        message: {
          level: 'error',
          rendered: 'error[E0308]: mismatched types\n --> src/lib.rs:3:5\n',
        },
      }),
      JSON.stringify({
        reason: 'compiler-message',
        message: { level: 'warning', rendered: 'warning: unused variable' },
      }),
    ].join('\n');

    expect(cargoBuildErrors(stdout)).toBe('error[E0308]: mismatched types\n --> src/lib.rs:3:5');
    expect(cargoBuildErrors('')).toBe('');
  });
});
