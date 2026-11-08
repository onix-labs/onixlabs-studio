// The Rust test adapter's entry point: serves the test-adapter protocol over standard streams (#1356).
//
// Discovery reads each crate's sources; a run is a `cargo test` command Studio runs in a visible
// terminal; results are read from what that command printed, since libtest's report formats are
// nightly-only. No `debug`: Studio ships no debug adapter for Rust yet.
import { execFile } from 'node:child_process';
import type { TestAdapter } from '../../protocol/testing/serve';
import { serve } from '../../protocol/testing/serve';
import { cargoTestCommand } from './command';
import { discoverRust } from './discover';
import { readCargoTranscript } from './transcript';

/**
 * Asks the cargo on the PATH for its version.
 * @returns Returns the version line, or null when there is no cargo.
 */
function cargoVersion(): Promise<string | null> {
  return new Promise<string | null>((resolve: (version: string | null) => void): void => {
    execFile('cargo', ['--version'], { timeout: 10_000 }, (error, stdout: string): void => {
      resolve(error === null ? stdout.trim().replace(/^cargo /, '') : null);
    });
  });
}

const adapter: TestAdapter = {
  capabilities: ['run', 'runSelected'],
  toolVersion: cargoVersion,
  discover: async (root: string) => (await discoverRust(root)).nodes,
  run: async (root: string, params) => cargoTestCommand(root, await discoverRust(root), params.ids),
  results: async (root: string, params) =>
    readCargoTranscript(root, await discoverRust(root), params.ids, params.output, params.exitCode),
};

serve(adapter);
