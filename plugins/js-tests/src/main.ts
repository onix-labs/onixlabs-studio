// The JavaScript test adapter's entry point (#1354).
//
// Started by Studio, it serves the test-adapter protocol on its standard streams. Started with
// `--run-steps`, it is instead the runner of a run with several steps, in the user's terminal: it runs
// each step's tool in turn with the terminal's own streams, and exits with the worst exit code.
import { spawnSync, SpawnSyncReturns } from 'node:child_process';
import { serve } from '../../protocol/testing/serve';
import { jsTestAdapter } from './adapter';
import type { Invocation } from './plan';

/**
 * Runs a run's steps one after another.
 * @param steps The steps, as `commandFor` wrote them.
 * @returns Returns the exit code: the first non-zero one, or zero.
 */
function runSteps(steps: readonly Invocation[]): number {
  let worst: number = 0;
  for (const step of steps) {
    process.stdout.write(`\n> ${step.label}: ${[step.executable, ...step.args].join(' ')}\n\n`);
    const result: SpawnSyncReturns<Buffer> = spawnSync(step.executable, [...step.args], {
      cwd: step.cwd,
      env: { ...process.env, ...step.env, ELECTRON_RUN_AS_NODE: undefined },
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    const code: number = result.status ?? 1;
    if (worst === 0 && code !== 0) {
      worst = code;
    }
  }
  return worst;
}

if (process.argv[2] === '--run-steps') {
  process.exit(runSteps(JSON.parse(process.argv[3] ?? '[]') as Invocation[]));
} else {
  serve(
    jsTestAdapter({
      executable: process.execPath,
      args: [process.argv[1]],
      // Studio runs plugins under its own runtime, which is Electron's; this asks it to be Node again.
      env: { ELECTRON_RUN_AS_NODE: '1' },
    }),
  );
}
