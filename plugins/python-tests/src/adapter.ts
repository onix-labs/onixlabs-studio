// The Python test adapter (#1355): pytest, and the unittest suites pytest runs, found by reading a
// folder's files and run by the project's own interpreter.
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
import { discoverPython } from './discover';
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
export function pythonTestAdapter(runner: Runner): TestAdapter {
  return {
    capabilities: ['run', 'runSelected', 'debug'],
    // Each project brings its own interpreter and pytest, so there is no one version to report.
    toolVersion: (): Promise<string | null> => Promise.resolve(null),
    discover: async (root: string): Promise<readonly TestNode[]> =>
      (await discoverPython(root)).tests,
    run: async (root: string, params: RunParams): Promise<TestCommand> =>
      commandFor(
        planSteps(await discoverPython(root), params.ids),
        root,
        params.outputDirectory,
        runner,
      ),
    results: async (root: string, params: ResultsParams): Promise<TestRunResults> =>
      readRunReports(
        await discoverPython(root),
        params.outputDirectory,
        params.exitCode,
        params.output,
      ),
    debug: async (root: string, params: DebugParams): Promise<TestDebugLaunch> =>
      debugLaunchFor(await discoverPython(root), params.id, root),
  };
}
