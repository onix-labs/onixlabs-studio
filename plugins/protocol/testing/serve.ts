// Serves a test adapter over the test-adapter protocol on the plugin's standard streams (#1351).
//
// Studio spawns the plugin once and keeps it running. Each line on stdin is one request; each answer goes
// back as one line on stdout carrying the request's `id`. Requests are answered as they finish, so a long
// discovery does not hold up a run's results.
//
// ⚠️ stdout carries the protocol and nothing else: a stray line on it is a response Studio refuses as
// malformed. Diagnostics go to stderr through `note`, which Studio records in its log.
import { createInterface, Interface } from 'node:readline';
import {
  DebugParams,
  ResultsParams,
  RunParams,
  TEST_ADAPTER_PROTOCOL,
  TestAdapterCapability,
  TestCommand,
  TestDebugLaunch,
  TestNode,
  TestRunResults,
} from './protocol';

/**
 * What one ecosystem's adapter does: the part of a plugin that is neither the wire nor the shared
 * readers.
 */
export interface TestAdapter {
  /**
   * Gets the capabilities the adapter confirms.
   */
  readonly capabilities: readonly TestAdapterCapability[];

  /**
   * Reports the version of the tool the adapter runs, or null when none was found.
   * @returns Returns the version.
   */
  toolVersion(): Promise<string | null>;

  /**
   * Finds a folder's tests by reading its files. ⛔ Runs none of the folder's code.
   * @param root The absolute folder.
   * @returns Returns the root nodes.
   */
  discover(root: string): Promise<readonly TestNode[]>;

  /**
   * Answers with the command that runs the tests asked for.
   * @param root The absolute folder.
   * @param params What to run and where to write the report.
   * @returns Returns the command.
   */
  run(root: string, params: RunParams): Promise<TestCommand>;

  /**
   * Reads how a run came out.
   * @param root The absolute folder.
   * @param params The run, its exit code and transcript.
   * @returns Returns the results.
   */
  results(root: string, params: ResultsParams): Promise<TestRunResults>;

  /**
   * Answers with a debug launch for one test, when the adapter can.
   * @param root The absolute folder.
   * @param params The test.
   * @returns Returns the launch.
   */
  debug?(root: string, params: DebugParams): Promise<TestDebugLaunch>;
}

/**
 * Writes a note to stderr, which Studio records in its log.
 * @param message The note.
 */
export function note(message: string): void {
  process.stderr.write(`${message}\n`);
}

/**
 * Reads a list of strings from untrusted parameters.
 * @param value The candidate.
 * @returns Returns the strings, dropping anything else.
 */
function strings(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((entry: unknown): entry is string => typeof entry === 'string')
    : [];
}

/**
 * Answers one request.
 * @param adapter The adapter.
 * @param op The operation.
 * @param root The folder, absent only for the handshake.
 * @param params The parameters, untrusted.
 * @returns Returns the result.
 */
export async function answer(
  adapter: TestAdapter,
  op: string,
  root: string | undefined,
  params: Record<string, unknown>,
): Promise<unknown> {
  if (op === 'initialize') {
    return {
      protocol: TEST_ADAPTER_PROTOCOL,
      capabilities: adapter.capabilities,
      toolVersion: await adapter.toolVersion(),
    };
  }
  if (root === undefined) {
    throw new Error(`${op} needs a folder.`);
  }
  const outputDirectory: string =
    typeof params['outputDirectory'] === 'string' ? params['outputDirectory'] : '';
  switch (op) {
    case 'discover':
      return { tests: await adapter.discover(root) };
    case 'run':
      return adapter.run(root, { ids: strings(params['ids']), outputDirectory });
    case 'results':
      return adapter.results(root, {
        ids: strings(params['ids']),
        outputDirectory,
        exitCode: typeof params['exitCode'] === 'number' ? params['exitCode'] : -1,
        output: typeof params['output'] === 'string' ? params['output'] : '',
      });
    case 'debug':
      if (adapter.debug === undefined) {
        throw new Error('This adapter cannot debug a test.');
      }
      return adapter.debug(root, {
        id: typeof params['id'] === 'string' ? params['id'] : '',
        outputDirectory,
      });
    default:
      throw new Error(`Unknown operation ${op}.`);
  }
}

/**
 * Serves an adapter until Studio closes the plugin's stdin.
 * @param adapter The adapter.
 */
export function serve(adapter: TestAdapter): void {
  const send: (message: unknown) => void = (message: unknown): void => {
    process.stdout.write(`${JSON.stringify(message)}\n`);
  };
  const handle: (line: string) => Promise<void> = async (line: string): Promise<void> => {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      note('Ignored a line that is not JSON');
      return;
    }
    if (typeof message !== 'object' || message === null) {
      return;
    }
    const record: Record<string, unknown> = message as Record<string, unknown>;
    const id: unknown = record['id'];
    const op: unknown = record['op'];
    if (typeof id !== 'number' || typeof op !== 'string') {
      note('Ignored a request with no id or operation');
      return;
    }
    const root: string | undefined =
      typeof record['root'] === 'string' ? record['root'] : undefined;
    const params: Record<string, unknown> =
      typeof record['params'] === 'object' && record['params'] !== null
        ? (record['params'] as Record<string, unknown>)
        : {};
    try {
      send({ id, ok: true, result: await answer(adapter, op, root, params) });
    } catch (error: unknown) {
      send({ id, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  };
  const lines: Interface = createInterface({ input: process.stdin });
  lines.on('line', (line: string): void => {
    if (line.trim().length > 0) {
      void handle(line);
    }
  });
  // Studio closing stdin is how it says the session is over.
  lines.on('close', (): void => {
    process.exit(0);
  });
}
