// The Go test adapter's entry point: serves the test-adapter protocol over standard streams (#1357).
//
// Discovery reads each package's `_test.go` files; a run is a `go test -v` command Studio runs in a
// visible terminal; results are read from what that command printed. No `debug`: Studio ships no debug
// adapter for Go (Delve) yet.
import { execFile } from 'node:child_process';
import type { TestAdapter } from '../../protocol/testing/serve';
import { serve } from '../../protocol/testing/serve';
import { goTestCommand } from './command';
import { discoverGo } from './discover';
import { readGoTranscript } from './transcript';

/**
 * Asks the go on the PATH for its version.
 * @returns Returns the version, or null when there is no go.
 */
function goVersion(): Promise<string | null> {
  return new Promise<string | null>((resolve: (version: string | null) => void): void => {
    execFile('go', ['version'], { timeout: 10_000 }, (error, stdout: string): void => {
      resolve(error === null ? (/go(\d[\w.]*)/.exec(stdout)?.[1] ?? stdout.trim()) : null);
    });
  });
}

const adapter: TestAdapter = {
  capabilities: ['run', 'runSelected'],
  toolVersion: goVersion,
  discover: async (root: string) => (await discoverGo(root)).nodes,
  run: async (root: string, params) => goTestCommand(await discoverGo(root), params.ids),
  results: async (root: string, params) =>
    readGoTranscript(root, await discoverGo(root), params.output, params.exitCode),
};

serve(adapter);
