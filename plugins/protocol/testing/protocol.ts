// The test-adapter protocol, as the test-adapter plugins speak it (#1351).
//
// Declared here rather than imported from the application's `@shared/api`: an adapter is a separate
// program whose contract with Studio is the wire protocol, not shared TypeScript. This module is bundled
// into each adapter, so every plugin artefact stays self-contained, and the contract spec in
// `src/shared/electron/test-adapters/` is what proves the two agree across the real process boundary.

/**
 * The protocol version these plugins speak.
 */
export const TEST_ADAPTER_PROTOCOL: string = '1.0';

/**
 * Names one optional capability.
 */
export type TestAdapterCapability = 'run' | 'runSelected' | 'debug';

/**
 * Says what a node in the test tree is.
 */
export type TestNodeKind = 'project' | 'file' | 'suite' | 'test';

/**
 * Describes where something is in a source file.
 */
export interface TestLocation {
  /**
   * Gets the absolute path of the file.
   */
  readonly file: string;

  /**
   * Gets the 1-based line.
   */
  readonly line: number;
}

/**
 * Describes one node in the test tree.
 */
export interface TestNode {
  /**
   * Gets the node's identifier, unique within one folder's answer and stable between discoveries.
   */
  readonly id: string;

  /**
   * Gets what the panel shows.
   */
  readonly label: string;

  /**
   * Gets what the node is.
   */
  readonly kind: TestNodeKind;

  /**
   * Gets the framework, or undefined to inherit the nearest ancestor's.
   */
  readonly framework?: string;

  /**
   * Gets where it is declared.
   */
  readonly location?: TestLocation;

  /**
   * Gets the nodes beneath it.
   */
  readonly children?: readonly TestNode[];
}

/**
 * Describes a command for Studio to run in a visible terminal.
 */
export interface TestCommand {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly title: string;
  readonly env?: Readonly<Record<string, string>>;
}

/**
 * Says how one test came out.
 */
export type TestOutcome = 'passed' | 'failed' | 'skipped' | 'errored';

/**
 * Describes one frame of a failure's stack.
 */
export interface TestStackFrame {
  readonly text: string;
  readonly location?: TestLocation;
}

/**
 * Describes how one test came out.
 */
export interface TestResult {
  readonly id: string;
  readonly outcome: TestOutcome;
  readonly durationMs?: number;
  readonly message?: string;
  readonly stack?: readonly TestStackFrame[];
  readonly output?: string;
  readonly parentId?: string;
  readonly label?: string;
  readonly location?: TestLocation;
}

/**
 * Describes what a run found.
 */
export interface TestRunResults {
  readonly results: readonly TestResult[];
  readonly problem?: string;
}

/**
 * Describes a debug launch for one test.
 */
export interface TestDebugLaunch {
  readonly adapter: string;
  readonly title: string;
  readonly program?: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly configuration?: Readonly<Record<string, string | boolean | number>>;
}

/**
 * The parameters of `run`.
 */
export interface RunParams {
  /**
   * Gets the tests to run by node identifier, or empty for every test.
   */
  readonly ids: readonly string[];

  /**
   * Gets the empty folder Studio made for the run's report.
   */
  readonly outputDirectory: string;
}

/**
 * The parameters of `results`.
 */
export interface ResultsParams extends RunParams {
  /**
   * Gets the command's exit code, or -1 when it was stopped or never started.
   */
  readonly exitCode: number;

  /**
   * Gets what the command printed, without colour codes, cut to its last megabyte.
   */
  readonly output: string;
}

/**
 * The parameters of `debug`.
 */
export interface DebugParams {
  /**
   * Gets the test to debug, by node identifier.
   */
  readonly id: string;

  /**
   * Gets the empty folder Studio made for the launch.
   */
  readonly outputDirectory: string;
}
