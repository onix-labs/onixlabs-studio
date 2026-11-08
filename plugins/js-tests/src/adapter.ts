// The JavaScript test adapter (#1354): Vitest, Jest and Playwright Test, found by reading a folder's
// files and run by the tools the folder itself installs.
import type { TestAdapter } from '../../protocol/testing/serve';
import type {
  DebugParams,
  ResultsParams,
  RunParams,
  TestCommand,
  TestDebugLaunch,
  TestNode,
  TestRunResults,
} from '../../protocol/testing/protocol';
import { discoverJs } from './discover';
import { commandFor, debugLaunchFor, planSteps } from './plan';
import { readRunReports } from './reports';

/**
 * Describes how this plugin's own entry point is started again, as the runner of a run with several
 * steps.
 */
export interface Runner {
  readonly executable: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
}

/**
 * Builds the adapter.
 * @param runner How to start this plugin's runner.
 * @returns Returns the adapter.
 */
export function jsTestAdapter(runner: Runner): TestAdapter {
  return {
    capabilities: ['run', 'runSelected', 'debug'],
    // Each package brings its own tools, at its own versions, so there is no one version to report.
    toolVersion: (): Promise<string | null> => Promise.resolve(null),
    discover: async (root: string): Promise<readonly TestNode[]> => (await discoverJs(root)).tests,
    run: async (root: string, params: RunParams): Promise<TestCommand> =>
      commandFor(
        planSteps(await discoverJs(root), params.ids),
        root,
        params.outputDirectory,
        runner,
      ),
    results: (_root: string, params: ResultsParams): Promise<TestRunResults> =>
      readRunReports(params.outputDirectory, params.exitCode, params.ids),
    debug: async (root: string, params: DebugParams): Promise<TestDebugLaunch> =>
      debugLaunchFor(await discoverJs(root), params.id, root),
  };
}
