// The .NET test adapter (#1353): xUnit, NUnit and MSTest, and Playwright for .NET, which runs through
// them. Discovery reads project files and sources; a run is a `dotnet test` command Studio runs in a
// visible terminal; results are the TRX reports that command writes.
import { execFile } from 'node:child_process';
import * as path from 'node:path';
import type { TestAdapter } from '../../protocol/testing/serve';
import type {
  ResultsParams,
  RunParams,
  TestCommand,
  TestNode,
  TestRunResults,
} from '../../protocol/testing/protocol';
import { readSource, walkFiles } from '../../protocol/testing/source';
import { planRun, usesTestingPlatform } from './command';
import { discoverTests } from './discover';
import { readResults } from './results';

/**
 * How long asking the SDK for its version may take.
 */
const VERSION_TIMEOUT_MS: number = 5_000;

/**
 * Finds the solutions in a folder.
 * @param root The absolute folder.
 * @returns Returns their paths.
 */
async function findSolutions(root: string): Promise<readonly string[]> {
  return walkFiles(root, { accept: (name: string): boolean => /\.slnx?$/i.test(name) });
}

/**
 * Reports the SDK's version. `dotnet --version` reads the SDK and the nearest global.json; it builds
 * and runs nothing of the folder's.
 * @returns Returns the version, or null when no SDK answered.
 */
function sdkVersion(): Promise<string | null> {
  return new Promise<string | null>((resolve: (version: string | null) => void): void => {
    execFile('dotnet', ['--version'], { timeout: VERSION_TIMEOUT_MS }, (error, stdout: string) => {
      resolve(error === null ? stdout.trim() || null : null);
    });
  });
}

/**
 * The adapter.
 */
export const dotnetAdapter: TestAdapter = {
  capabilities: ['run', 'runSelected'],

  toolVersion: sdkVersion,

  discover: (root: string): Promise<readonly TestNode[]> => discoverTests(root),

  run: async (root: string, params: RunParams): Promise<TestCommand> =>
    planRun(await discoverTests(root), params.ids, {
      root,
      solutions: await findSolutions(root),
      testingPlatform: usesTestingPlatform(await readSource(path.join(root, 'global.json'))),
      outputDirectory: params.outputDirectory,
    }),

  results: (root: string, params: ResultsParams): Promise<TestRunResults> =>
    readResults(root, params.outputDirectory, params.exitCode, params.output),
};
