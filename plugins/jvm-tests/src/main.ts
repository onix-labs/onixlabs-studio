// The JVM test adapter's entry point: serves the test-adapter protocol over standard streams (#1358).
//
// Discovery reads each project's `src/test` sources; a run is a Gradle or Maven command Studio runs in a
// visible terminal; results are read from the JUnit reports the build writes. No `debug`: Studio ships
// no JVM debug adapter yet.
import { execFile } from 'node:child_process';
import * as path from 'node:path';
import type { TestCommand } from '../../protocol/testing/protocol';
import type { TestAdapter } from '../../protocol/testing/serve';
import { serve } from '../../protocol/testing/serve';
import { jvmTestCommand } from './command';
import { discoverJvm } from './discover';
import { jvmResults, stampStart } from './results';

/**
 * Asks Java for its version — `JAVA_HOME`'s, which Gradle and Maven use, else the PATH's.
 * @returns Returns the version, or null when there is no Java.
 */
function javaVersion(): Promise<string | null> {
  const home: string | undefined = process.env['JAVA_HOME'];
  const java: string =
    home === undefined || home.length === 0 ? 'java' : path.join(home, 'bin', 'java');
  return new Promise<string | null>((resolve: (version: string | null) => void): void => {
    execFile(
      java,
      ['-version'],
      { timeout: 10_000 },
      (error, _stdout: string, stderr: string): void => {
        resolve(error === null ? (/version "([^"]+)"/.exec(stderr)?.[1] ?? null) : null);
      },
    );
  });
}

const adapter: TestAdapter = {
  capabilities: ['run', 'runSelected'],
  toolVersion: javaVersion,
  discover: async (root: string) => (await discoverJvm(root)).nodes,
  run: async (root: string, params) => {
    const command: TestCommand = jvmTestCommand(await discoverJvm(root), params.ids);
    await stampStart(params.outputDirectory);
    return command;
  },
  results: async (root: string, params) =>
    jvmResults(
      await discoverJvm(root),
      params.ids,
      params.outputDirectory,
      params.output,
      params.exitCode,
    ),
};

serve(adapter);
