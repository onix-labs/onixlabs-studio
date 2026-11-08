import type {
  TestAdapterCapability,
  TestAdapterErrorCode,
  TestCommand,
  TestDebugLaunch,
  TestDiscovery,
  TestRunResults,
} from './test-adapter-protocol';

/**
 * Names the test IPC channels (#1351): what the Tests panel asks the main process's test-adapter host.
 * Every one is an invoke, and every folder is checked by the host — open, trusted — before any plugin
 * hears of it.
 */
export enum TestChannel {
  /**
   * Lists the adapters that apply to a folder, installed or not, so the panel can offer the install
   * (invoke).
   */
  Adapters = 'test:adapters',

  /**
   * Finds a folder's tests through one adapter (invoke).
   */
  Discover = 'test:discover',

  /**
   * Plans a run: makes its output folder and answers with the command to run (invoke).
   */
  PlanRun = 'test:plan-run',

  /**
   * Reads a planned run's results once its command has exited, and removes its output folder (invoke).
   */
  Results = 'test:results',

  /**
   * Plans a debug launch of one test (invoke).
   */
  PlanDebug = 'test:plan-debug',

  /**
   * Forgets a planned run or launch that will not report, removing its output folder (invoke).
   */
  Finish = 'test:finish',
}

/**
 * Describes an adapter that applies to a folder.
 */
export interface TestAdapterInfo {
  /**
   * Gets the plugin's identifier, which every other request names.
   */
  readonly pluginId: string;

  /**
   * Gets the display name, such as `.NET Tests`.
   */
  readonly displayName: string;

  /**
   * Gets the frameworks it serves, for display.
   */
  readonly frameworks: readonly string[];

  /**
   * Gets whether it is installed. One that is not can only be offered for install.
   */
  readonly installed: boolean;

  /**
   * Gets the optional capabilities its manifest declares. The host also requires the running plugin to
   * confirm each one.
   */
  readonly capabilities: readonly TestAdapterCapability[];
}

/**
 * Describes a host's answer: the value on success, or the reason it failed.
 */
export type TestHostAnswer<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string; readonly code?: TestAdapterErrorCode };

/**
 * Describes a planned run: the command to run, and the identifier its results are read back by.
 */
export interface TestRunPlan {
  /**
   * Gets the run's identifier, which {@link TestChannel.Results} and {@link TestChannel.Finish} name.
   */
  readonly runId: string;

  /**
   * Gets the command to run in the Tests terminal.
   */
  readonly command: TestCommand;

  /**
   * Gets whether the command runs only the tests asked for. False when the adapter cannot narrow a run,
   * so every test it found runs.
   */
  readonly selected: boolean;
}

/**
 * Describes a planned debug launch.
 */
export interface TestDebugPlan {
  /**
   * Gets the launch's identifier, which {@link TestChannel.Finish} names once the session ends.
   */
  readonly runId: string;

  /**
   * Gets the launch to hand the debugger.
   */
  readonly launch: TestDebugLaunch;
}

/**
 * The answer to {@link TestChannel.Discover}.
 */
export type TestDiscoverAnswer = TestHostAnswer<TestDiscovery>;

/**
 * The answer to {@link TestChannel.PlanRun}.
 */
export type TestRunPlanAnswer = TestHostAnswer<TestRunPlan>;

/**
 * The answer to {@link TestChannel.Results}.
 */
export type TestResultsAnswer = TestHostAnswer<TestRunResults>;

/**
 * The answer to {@link TestChannel.PlanDebug}.
 */
export type TestDebugPlanAnswer = TestHostAnswer<TestDebugPlan>;
