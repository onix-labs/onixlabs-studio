// The test-adapter protocol shared between the Electron main process and every test-adapter plugin
// (#802). Keep this module platform-neutral (no Node or DOM dependencies) so both compilation targets
// can import it.
//
// Tests are a plugin like every other seam: Studio's Tests panel draws a tree, runs what the user
// picks and shows what came back, and a plugin — .NET (xUnit, NUnit, MSTest), JavaScript (Vitest, Jest,
// Playwright Test), Python (pytest), Rust, Go, the JVM and CTest — knows how its ecosystem finds and
// runs tests. ⛔ Core knows no framework: not a name, not an attribute, not a report format.
//
// The transport is newline-delimited JSON over standard streams, exactly as for package managers: one
// request per line in, one response per line out, correlated by `id`.
//
// Decisions this protocol carries (taken on Matthew's behalf, 2026-11-08, #802):
// - **Discovery reads source; it runs nothing.** `discover` answers from the files on disk — the
//   attributes, functions and declarations that make a test — so opening a workspace never builds it or
//   executes its code. What only a run can know (a theory's cases, a parametrised test's instances) comes
//   back with the results and joins the tree then.
// - **A run is a command Studio runs in a visible terminal**, as a package manager's writes are. The
//   plugin never runs a test itself: it answers `run` with the program, arguments and folder, Studio runs
//   them in the workspace's Tests terminal, and the user can read the output and stop it. Afterwards
//   the plugin reads the report its command wrote (TRX, JUnit XML, a JSON reporter's file) or, where a
//   tool writes none, the terminal's transcript, and answers `results`.
// - **Debugging a test is a DAP launch.** `debug` answers with which debug adapter to use and the launch
//   configuration to give it; Studio's existing debugger starts it. A plugin whose ecosystem has no
//   adapter Studio can start does not advertise `debug`.

/**
 * Holds the protocol version this build speaks. A plugin announcing a different major version is
 * refused rather than spoken to: one that misreads a request could hand back a command the user did not
 * ask for.
 */
export const TEST_ADAPTER_PROTOCOL_VERSION: string = '1.0';

/**
 * Names one optional capability a test-adapter plugin can advertise. Finding a folder's tests
 * (`discover`) is what makes a plugin a test adapter, so it is not one of these.
 *
 * A plugin declares these in its manifest, because the panel draws its controls before any process has
 * started, and the handshake confirms them: Studio offers only what both say.
 */
export type TestAdapterCapability =
  /**
   * Answering with the command that runs every test the plugin found.
   */
  | 'run'

  /**
   * A qualifier on `run`: the command can be narrowed to the tests asked for. Without it, running one
   * test runs them all.
   */
  | 'runSelected'

  /**
   * Answering with a debug launch for one test.
   */
  | 'debug';

/**
 * The optional capabilities a plugin can advertise, the closed list a manifest is validated against.
 */
export const TEST_ADAPTER_CAPABILITIES: readonly TestAdapterCapability[] = [
  'run',
  'runSelected',
  'debug',
];

/**
 * Says what a node in the test tree is. The panel draws each kind with its own icon and nothing else
 * depends on it: a plugin picks whichever reads right for its ecosystem.
 */
export type TestNodeKind =
  /**
   * A project, crate, module or package: the root of a plugin's tree.
   */
  | 'project'

  /**
   * A source file.
   */
  | 'file'

  /**
   * A class, fixture, `describe` block or module of tests.
   */
  | 'suite'

  /**
   * One test, or one case of a parametrised test.
   */
  | 'test';

/**
 * The kinds a node can be, the closed list a plugin's answer is checked against.
 */
export const TEST_NODE_KINDS: readonly TestNodeKind[] = ['project', 'file', 'suite', 'test'];

/**
 * Describes where something is in a source file.
 */
export interface TestLocation {
  /**
   * Gets the absolute path of the file. Studio links to it only when it lies within the folder.
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
   * Gets the node's identifier, unique within the plugin's answer for one folder and stable from one
   * discovery to the next, so a node keeps its last result when the tree is read again. Opaque to
   * Studio: only the plugin reads meaning into it.
   */
  readonly id: string;

  /**
   * Gets what the panel shows for the node.
   */
  readonly label: string;

  /**
   * Gets what the node is.
   */
  readonly kind: TestNodeKind;

  /**
   * Gets the test framework, as a name the user knows (`xUnit`, `Vitest`), or undefined to inherit the
   * nearest ancestor's.
   */
  readonly framework?: string;

  /**
   * Gets where the node is declared, or undefined when it has no one place.
   */
  readonly location?: TestLocation;

  /**
   * Gets the nodes beneath it, or undefined for a leaf.
   */
  readonly children?: readonly TestNode[];
}

/**
 * Describes a folder's tests: a tree per project, as the plugin found them.
 */
export interface TestDiscovery {
  /**
   * Gets the root nodes, usually one per project.
   */
  readonly tests: readonly TestNode[];
}

/**
 * Describes a command a plugin wants run. Studio runs it in a visible terminal; the plugin never does.
 */
export interface TestCommand {
  /**
   * Gets the program to run, by name or path.
   */
  readonly executable: string;

  /**
   * Gets the arguments, one per entry, so a test name cannot be read as anything but an argument.
   */
  readonly args: readonly string[];

  /**
   * Gets the absolute folder to run it in, which must lie within the folder the request named.
   */
  readonly cwd: string;

  /**
   * Gets the title of the terminal it runs in, in the user's terms, such as `Test Shop.Tests`.
   */
  readonly title: string;

  /**
   * Gets environment variables set for the command, or undefined for none. A reporter that is told
   * where to write by the environment needs this; nothing else should.
   */
  readonly env?: Readonly<Record<string, string>>;
}

/**
 * Says how one test came out.
 */
export type TestOutcome =
  /**
   * It ran and passed.
   */
  | 'passed'

  /**
   * It ran and an assertion failed.
   */
  | 'failed'

  /**
   * It was skipped or ignored.
   */
  | 'skipped'

  /**
   * It could not run, or broke for a reason that is not an assertion: a build failure, a crash, a
   * timeout.
   */
  | 'errored';

/**
 * The outcomes a test can have, the closed list a plugin's answer is checked against.
 */
export const TEST_OUTCOMES: readonly TestOutcome[] = ['passed', 'failed', 'skipped', 'errored'];

/**
 * Describes one frame of a failure's stack.
 */
export interface TestStackFrame {
  /**
   * Gets the frame as the tool printed it.
   */
  readonly text: string;

  /**
   * Gets where the frame points, or undefined when it names no file Studio can open.
   */
  readonly location?: TestLocation;
}

/**
 * Describes how one test came out.
 */
export interface TestResult {
  /**
   * Gets the test's identifier, as `discover` named it. A test only a run could find, such as one case
   * of a theory, has an identifier `discover` never named, and carries {@link parentId} and
   * {@link label} so the panel can place it.
   */
  readonly id: string;

  /**
   * Gets how it came out.
   */
  readonly outcome: TestOutcome;

  /**
   * Gets how long it took, in milliseconds, or undefined when the tool did not say.
   */
  readonly durationMs?: number;

  /**
   * Gets the failure's message, or the reason it was skipped.
   */
  readonly message?: string;

  /**
   * Gets the failure's stack, outermost frame last.
   */
  readonly stack?: readonly TestStackFrame[];

  /**
   * Gets what the test wrote while it ran, when the tool kept it apart.
   */
  readonly output?: string;

  /**
   * Gets the identifier of the node a test found only by running belongs under.
   */
  readonly parentId?: string;

  /**
   * Gets what the panel shows for a test found only by running.
   */
  readonly label?: string;

  /**
   * Gets where a test found only by running is declared.
   */
  readonly location?: TestLocation;
}

/**
 * Describes what a run found.
 */
export interface TestRunResults {
  /**
   * Gets each test's result. A test that was asked for and is absent did not run.
   */
  readonly results: readonly TestResult[];

  /**
   * Gets why the run as a whole failed when no test could report — a build that broke, a tool that is
   * missing — or undefined when the results say it all.
   */
  readonly problem?: string;
}

/**
 * Describes a debug launch for one test, which Studio hands to its debugger.
 */
export interface TestDebugLaunch {
  /**
   * Gets the debug adapter to start, by the identifier it is installed under, such as `js-debug`.
   */
  readonly adapter: string;

  /**
   * Gets the title of the debug session.
   */
  readonly title: string;

  /**
   * Gets the program to launch, or undefined when the adapter is told what to run another way, as
   * debugpy is by its `module` key.
   */
  readonly program?: string;

  /**
   * Gets its arguments.
   */
  readonly args: readonly string[];

  /**
   * Gets the absolute folder to launch it in, which must lie within the folder the request named.
   */
  readonly cwd: string;

  /**
   * Gets environment variables for it, or undefined for none.
   */
  readonly env?: Readonly<Record<string, string>>;

  /**
   * Gets launch-configuration keys only the adapter reads, such as debugpy's `module`, or undefined
   * for none. Studio passes them through and reads none of them.
   */
  readonly configuration?: Readonly<Record<string, string | boolean | number>>;
}

/**
 * Describes what a plugin said it is, in answer to `initialize`.
 */
export interface TestAdapterDescription {
  /**
   * Gets the protocol version the plugin speaks.
   */
  readonly protocol: string;

  /**
   * Gets the capabilities the running plugin confirms.
   */
  readonly capabilities: readonly TestAdapterCapability[];

  /**
   * Gets the version of the tool the plugin found, or null when it found none or needs none.
   */
  readonly toolVersion: string | null;

  /**
   * Gets why the plugin cannot do its work, when it cannot.
   */
  readonly problem?: string;
}

/**
 * Describes every operation: its parameters and its result.
 */
export interface TestAdapterOperations {
  /**
   * Completes the handshake. Sent once, first, and carries no root.
   */
  initialize: {
    readonly params: {
      /**
       * Gets the protocol version Studio speaks.
       */
      readonly protocol: string;
    };
    readonly result: TestAdapterDescription;
  };

  /**
   * Finds a folder's tests by reading its files. Answers an empty tree when it holds none the plugin
   * can find. ⛔ Runs no code of the folder's.
   */
  discover: {
    readonly params: Readonly<Record<string, never>>;
    readonly result: TestDiscovery;
  };

  /**
   * Answers with the command that runs tests, and writes whatever report it writes into the output
   * folder Studio names.
   */
  run: {
    readonly params: {
      /**
       * Gets the tests to run, by node identifier — a project, suite or file standing for everything
       * under it — or empty for every test. A plugin without `runSelected` is only ever sent empty.
       */
      readonly ids: readonly string[];

      /**
       * Gets an empty folder Studio made for this run, outside the workspace, where the command may
       * write its report. Studio removes it once `results` has answered.
       */
      readonly outputDirectory: string;
    };
    readonly result: TestCommand;
  };

  /**
   * Reads how a run came out, once its command has exited.
   */
  results: {
    readonly params: {
      /**
       * Gets the tests the run was asked for, as `run` was sent them.
       */
      readonly ids: readonly string[];

      /**
       * Gets the run's output folder, as `run` was sent it.
       */
      readonly outputDirectory: string;

      /**
       * Gets the command's exit code, or -1 when it was stopped or never started.
       */
      readonly exitCode: number;

      /**
       * Gets what the command printed, without colour codes, cut to its last megabyte. For a tool that
       * writes no report this is the only account of the run.
       */
      readonly output: string;
    };
    readonly result: TestRunResults;
  };

  /**
   * Answers with a debug launch for one test.
   */
  debug: {
    readonly params: {
      /**
       * Gets the test to debug, by node identifier.
       */
      readonly id: string;

      /**
       * Gets an empty folder Studio made for this launch, outside the workspace.
       */
      readonly outputDirectory: string;
    };
    readonly result: TestDebugLaunch;
  };
}

/**
 * Names an operation.
 */
export type TestAdapterOp = keyof TestAdapterOperations;

/**
 * Gets an operation's parameters.
 */
export type TestAdapterParams<Op extends TestAdapterOp> = TestAdapterOperations[Op]['params'];

/**
 * Gets an operation's result.
 */
export type TestAdapterResult<Op extends TestAdapterOp> = TestAdapterOperations[Op]['result'];

/**
 * The capability each optional operation needs. An operation not listed needs none.
 */
export const TEST_OP_CAPABILITY: Readonly<Partial<Record<TestAdapterOp, TestAdapterCapability>>> = {
  run: 'run',
  results: 'run',
  debug: 'debug',
};

/**
 * Describes a request sent to a plugin.
 */
export interface TestAdapterRequest<Op extends TestAdapterOp = TestAdapterOp> {
  /**
   * Gets the request correlation identifier.
   */
  readonly id: number;

  /**
   * Gets the operation requested.
   */
  readonly op: Op;

  /**
   * Gets the absolute folder the request acts on, absent only for `initialize`.
   */
  readonly root?: string;

  /**
   * Gets the operation's parameters.
   */
  readonly params: TestAdapterParams<Op>;
}

/**
 * Says why a request failed, when the reason changes what the surface does:
 * - `unsupported`: the plugin did not both declare and confirm the capability;
 * - `refused`: the host would not send the request, or would not accept its answer;
 * - `untrusted`: the user has not said they trust the folder.
 */
export type TestAdapterErrorCode = 'unsupported' | 'refused' | 'untrusted';

/**
 * Describes a plugin's answer to a request: the result on success, or the reason it failed.
 */
export type TestAdapterResponse<Op extends TestAdapterOp = TestAdapterOp> =
  | {
      /**
       * Gets the correlation identifier of the request this answers.
       */
      readonly id: number;

      /**
       * Discriminates the success case.
       */
      readonly ok: true;

      /**
       * Gets the operation's result.
       */
      readonly result: TestAdapterResult<Op>;
    }
  | {
      /**
       * Gets the correlation identifier of the request this answers.
       */
      readonly id: number;

      /**
       * Discriminates the failure case.
       */
      readonly ok: false;

      /**
       * Gets the reason, in the user's terms.
       */
      readonly error: string;

      /**
       * Gets what kind of failure it is, when that changes what the surface does.
       */
      readonly code?: TestAdapterErrorCode;
    };

/**
 * Determines whether a plugin's announced protocol version is one this build can speak: the same major
 * version. A newer minor only adds things, which a plugin may use and this build ignores.
 * @param announced The version the plugin announced.
 * @returns Returns true when the version can be spoken.
 */
export function isCompatibleTestAdapterProtocol(announced: unknown): boolean {
  if (typeof announced !== 'string' || !/^\d+(\.\d+)*$/.test(announced)) {
    return false;
  }
  const major: (version: string) => string = (version: string): string => version.split('.')[0];
  return major(announced) === major(TEST_ADAPTER_PROTOCOL_VERSION);
}

/**
 * Determines whether a value is a known optional capability.
 * @param value The candidate.
 * @returns Returns true when the value names a capability.
 */
export function isTestAdapterCapability(value: unknown): value is TestAdapterCapability {
  return (
    typeof value === 'string' && (TEST_ADAPTER_CAPABILITIES as readonly string[]).includes(value)
  );
}
