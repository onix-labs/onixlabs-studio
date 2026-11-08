// The CTest adapter's entry point: serves the test-adapter protocol over standard streams (#1359).
//
// Discovery asks ctest which tests a configured build directory declares (or reads `add_test` calls
// when there is none); a run is a `ctest` command Studio runs in a visible terminal; results are read
// from the JUnit report it writes into the run's output folder. No `debug`: Studio ships no C/C++
// debug adapter yet.
import { execFile } from 'node:child_process';
import type { TestAdapter } from '../../protocol/testing/serve';
import { serve } from '../../protocol/testing/serve';
import { discoverCTest } from './discover';
import { ctestCommand, ctestResults } from './run';

/**
 * Asks the ctest on the PATH for its version.
 * @returns Returns the version, or null when there is no ctest.
 */
function ctestVersion(): Promise<string | null> {
  return new Promise<string | null>((resolve: (version: string | null) => void): void => {
    execFile('ctest', ['--version'], { timeout: 10_000 }, (error, stdout: string): void => {
      resolve(error === null ? (/version (\S+)/.exec(stdout)?.[1] ?? null) : null);
    });
  });
}

const adapter: TestAdapter = {
  capabilities: ['run', 'runSelected'],
  toolVersion: ctestVersion,
  discover: async (root: string) => (await discoverCTest(root)).nodes,
  run: async (root: string, params) =>
    ctestCommand(await discoverCTest(root), params.ids, params.outputDirectory),
  results: async (root: string, params) =>
    ctestResults(
      await discoverCTest(root),
      params.ids,
      params.outputDirectory,
      params.output,
      params.exitCode,
    ),
};

serve(adapter);
