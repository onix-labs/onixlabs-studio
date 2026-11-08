import { ChildProcess, spawn } from 'node:child_process';
import {
  isCompatibleTestAdapterProtocol,
  isTestAdapterCapability,
  TEST_ADAPTER_PROTOCOL_VERSION,
  TestAdapterDescription,
  TestAdapterOp,
  TestAdapterParams,
  TestAdapterRequest,
  TestAdapterResponse,
} from '@shared/api/test-adapter-protocol';
import { logger } from '../logger';
import { LineSplitter } from '../line-splitter';
import { pluginEnvironment } from '../plugin-environment';
import { pidJournal } from '../pid-journal';
import { TestAdapterSpec } from './test-adapter-descriptor';
import { TestAdapterEndpoint } from './test-adapter-endpoint';

/**
 * Specifies how long the initialize handshake may take. A plugin that cannot say what it is promptly
 * is not one worth waiting on.
 */
const HANDSHAKE_TIMEOUT_MS: number = 10_000;

/**
 * Specifies the grace period, in milliseconds, between SIGTERM and SIGKILL when stopping a plugin.
 */
const KILL_GRACE_MS: number = 2_000;

/**
 * Specifies the longest stdout line the client buffers. A discovery of a large solution is one line, so
 * this is well above the shared default, and still bounded.
 */
export const TEST_ADAPTER_MAX_LINE_LENGTH: number = 32 * 1024 * 1024;

/**
 * Holds a request awaiting its answer.
 */
interface Pending {
  readonly resolve: (response: TestAdapterResponse) => void;
  readonly timer: NodeJS.Timeout;
}

/**
 * Speaks the test-adapter protocol to one plugin process (#1351).
 *
 * Long-lived for the session, like a package-manager plugin, so its start-up cost is paid once. Every
 * request resolves — to the plugin's answer, or to a failure saying why there was none — so a plugin
 * that dies, hangs or answers a question nobody asked costs the caller one failed operation.
 */
export class TestAdapterClient implements TestAdapterEndpoint {
  /**
   * Holds the plugin's identifier, for logging.
   */
  private readonly id: string;

  /**
   * Holds how to spawn the plugin.
   */
  private readonly spec: TestAdapterSpec;

  /**
   * Holds the longest stdout line the client will buffer before refusing it.
   */
  private readonly maxLineLength: number;

  /**
   * Holds the running process, or null before it starts and after it exits.
   */
  private process: ChildProcess | null = null;

  /**
   * Holds the requests awaiting answers, keyed by correlation identifier.
   */
  private readonly pending: Map<number, Pending> = new Map<number, Pending>();

  /**
   * Holds the next correlation identifier.
   */
  private nextId: number = 1;

  /**
   * Holds what the plugin said it was, or null before the handshake completes.
   */
  private description: TestAdapterDescription | null = null;

  /**
   * Holds whether the client has been disposed, so a late exit is not reported as a failure.
   */
  private disposed: boolean = false;

  /**
   * Initializes the client. The process is not started until {@link start} is called.
   * @param id The plugin identifier, for logging.
   * @param spec How to spawn the plugin.
   * @param maxLineLength The longest stdout line to buffer.
   */
  public constructor(
    id: string,
    spec: TestAdapterSpec,
    maxLineLength: number = TEST_ADAPTER_MAX_LINE_LENGTH,
  ) {
    this.id = id;
    this.spec = spec;
    this.maxLineLength = maxLineLength;
  }

  /**
   * Gets whether the plugin is running and has completed its handshake.
   * @returns Returns true while the plugin can be asked things.
   */
  public get running(): boolean {
    return this.description !== null && this.process !== null;
  }

  /**
   * Starts the plugin and completes the initialize handshake. A plugin announcing an incompatible
   * protocol is refused rather than spoken to.
   * @returns Returns what the plugin said it is, or null when it could not be started or was refused.
   */
  public async start(): Promise<TestAdapterDescription | null> {
    if (this.description !== null) {
      return this.description;
    }
    try {
      this.process = spawn(this.spec.command, [...this.spec.args], {
        stdio: ['pipe', 'pipe', 'pipe'],
        // Only what a program needs to run, never the user's whole shell (audit S6).
        env: pluginEnvironment(this.spec.env),
      });
    } catch (error: unknown) {
      logger.warn('TestAdapterClient', `Could not spawn '${this.id}'`, error);
      return null;
    }
    // Journalled like every other long-lived child, so one left behind by an abrupt exit is reaped on
    // the next launch (#583).
    pidJournal()?.register(this.process.pid, 'test-adapter', this.spec.command);

    this.process.stdout?.setEncoding('utf8');
    // One per process, so what a dead one left half-written can never be read as the start of its
    // successor's first line.
    const lines: LineSplitter = new LineSplitter({
      trim: true,
      maxLineLength: this.maxLineLength,
      onLine: (line: string): void => this.dispatch(line),
      onOversized: (): void => this.refuseOversizedLine(),
    });
    this.process.stdout?.on('data', (chunk: string): void => lines.push(chunk));
    this.process.stderr?.setEncoding('utf8');
    this.process.stderr?.on('data', (chunk: string): void => {
      logger.debug('TestAdapterClient', `[${this.id}] ${chunk.trimEnd()}`);
    });
    this.process.on('exit', (code: number | null): void => this.onExit(code));
    this.process.on('error', (error: Error): void => {
      logger.warn('TestAdapterClient', `'${this.id}' failed`, error);
      this.onExit(null);
    });

    const response: TestAdapterResponse = await this.send(
      'initialize',
      undefined,
      { protocol: TEST_ADAPTER_PROTOCOL_VERSION },
      HANDSHAKE_TIMEOUT_MS,
    );
    const description: TestAdapterDescription | null = response.ok
      ? readDescription(response.result)
      : null;
    if (description === null) {
      logger.warn('TestAdapterClient', `'${this.id}' did not initialize; discarding it`);
      this.dispose();
      return null;
    }
    if (!isCompatibleTestAdapterProtocol(description.protocol)) {
      logger.warn(
        'TestAdapterClient',
        `'${this.id}' speaks protocol ${description.protocol}, which this build cannot; discarding it`,
      );
      this.dispose();
      return null;
    }
    this.description = description;
    logger.info(
      'TestAdapterClient',
      `'${this.id}' ready (${description.toolVersion ?? 'no tool'}); capabilities: ${description.capabilities.join(', ') || 'none'}`,
    );
    return description;
  }

  /**
   * Asks the plugin to perform an operation.
   * @param op The operation.
   * @param root The absolute folder it acts on.
   * @param params The operation's parameters.
   * @param timeoutMs How long to wait before abandoning it.
   * @returns Returns the plugin's answer, or a failure saying why there was none.
   */
  public async request<Op extends TestAdapterOp>(
    op: Op,
    root: string,
    params: TestAdapterParams<Op>,
    timeoutMs: number,
  ): Promise<TestAdapterResponse<Op>> {
    if (this.description === null) {
      return { id: 0, ok: false, error: `${this.id} is not running.` };
    }
    return await this.send(op, root, params, timeoutMs);
  }

  /**
   * Stops the plugin and fails anything still in flight. SIGTERM, then SIGKILL after a grace period
   * for a plugin that ignores it.
   */
  public dispose(): void {
    this.disposed = true;
    this.failPending(`${this.id} was stopped.`);
    this.description = null;
    const child: ChildProcess | null = this.process;
    if (child === null) {
      return;
    }
    this.process = null;
    pidJournal()?.unregister(child.pid);
    child.stdin?.end();
    child.kill();
    logger.debug('TestAdapterClient', `'${this.id}' stopped`);
    if (child.exitCode !== null || child.signalCode !== null) {
      return;
    }
    const escalation: NodeJS.Timeout = setTimeout((): void => {
      if (child.exitCode === null && child.signalCode === null) {
        logger.warn('TestAdapterClient', `'${this.id}' ignored SIGTERM; killing it`);
        child.kill('SIGKILL');
      }
    }, KILL_GRACE_MS);
    escalation.unref?.();
    child.once('exit', (): void => clearTimeout(escalation));
  }

  /**
   * Sends a request and waits for its answer.
   * @param op The operation.
   * @param root The folder, or undefined for the handshake.
   * @param params The operation's parameters.
   * @param timeoutMs How long to wait before abandoning it.
   * @returns Returns the response, or a failure when the plugin is not running or did not answer.
   */
  private send(
    op: TestAdapterOp,
    root: string | undefined,
    params: unknown,
    timeoutMs: number,
  ): Promise<TestAdapterResponse> {
    const id: number = this.nextId;
    this.nextId += 1;
    if (this.process?.stdin === undefined || this.process.stdin === null || this.disposed) {
      return Promise.resolve({ id, ok: false, error: `${this.id} is not running.` });
    }
    const request: TestAdapterRequest = {
      id,
      op,
      ...(root === undefined ? {} : { root }),
      params: params as TestAdapterRequest['params'],
    };
    return new Promise<TestAdapterResponse>((resolve): void => {
      const timer: NodeJS.Timeout = setTimeout((): void => {
        this.pending.delete(id);
        logger.warn('TestAdapterClient', `'${this.id}' did not answer ${op} (${id}) in time`);
        resolve({ id, ok: false, error: `${this.id} did not answer in time.` });
      }, timeoutMs);
      timer.unref?.();
      this.pending.set(id, {
        resolve: (response: TestAdapterResponse): void => {
          clearTimeout(timer);
          resolve(response);
        },
        timer,
      });
      if (!this.write(request)) {
        clearTimeout(timer);
        this.pending.delete(id);
        resolve({ id, ok: false, error: `${this.id} could not be reached.` });
      }
    });
  }

  /**
   * Writes one message to the plugin.
   * @param message The message.
   * @returns Returns true when it was written.
   */
  private write(message: TestAdapterRequest): boolean {
    try {
      this.process?.stdin?.write(`${JSON.stringify(message)}\n`);
      return this.process !== null;
    } catch (error: unknown) {
      logger.warn('TestAdapterClient', `Could not write to '${this.id}'`, error);
      return false;
    }
  }

  /**
   * Refuses a stdout line that has outgrown {@link maxLineLength} without ending. Which request it
   * answered cannot be read without parsing it whole, so every request in flight is failed rather than
   * left to wait out its timeout for an answer that is gone.
   */
  private refuseOversizedLine(): void {
    logger.error(
      'TestAdapterClient',
      `'${this.id}' wrote a message over ${this.maxLineLength} characters; it was dropped`,
    );
    this.failPending(`${this.id} sent an answer too large to read.`);
  }

  /**
   * Parses one line: a response is handed to whoever is waiting for it, and anything else is dropped.
   * @param line The line.
   */
  private dispatch(line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      logger.debug('TestAdapterClient', `'${this.id}' wrote a line that is not JSON`);
      return;
    }
    const response: TestAdapterResponse | null = readResponse(parsed);
    if (response === null) {
      logger.debug('TestAdapterClient', `'${this.id}' wrote a malformed message`);
      return;
    }
    const entry: Pending | undefined = this.pending.get(response.id);
    if (entry === undefined) {
      return;
    }
    this.pending.delete(response.id);
    entry.resolve(response);
  }

  /**
   * Handles the plugin exiting, failing everything still in flight.
   * @param code The exit code, or null when it was killed.
   */
  private onExit(code: number | null): void {
    if (!this.disposed) {
      logger.warn('TestAdapterClient', `'${this.id}' exited (${code ?? 'signal'})`);
    }
    if (this.process !== null) {
      pidJournal()?.unregister(this.process.pid);
    }
    this.process = null;
    this.description = null;
    this.failPending(`${this.id} exited.`);
  }

  /**
   * Fails every request still awaiting an answer.
   * @param error The reason given to each.
   */
  private failPending(error: string): void {
    for (const [id, entry] of [...this.pending]) {
      clearTimeout(entry.timer);
      this.pending.delete(id);
      entry.resolve({ id, ok: false, error });
    }
  }
}

/**
 * Narrows an untrusted line to a response: a numeric id, and either a result or an error string.
 * @param value The parsed line.
 * @returns Returns the response, or null when the line is not one.
 */
function readResponse(value: unknown): TestAdapterResponse | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const record: Record<string, unknown> = value as Record<string, unknown>;
  if (typeof record['id'] !== 'number') {
    return null;
  }
  if (record['ok'] === true || (record['ok'] === false && typeof record['error'] === 'string')) {
    return record as unknown as TestAdapterResponse;
  }
  return null;
}

/**
 * Narrows an untrusted initialize result to a description, dropping capabilities this build does not
 * know rather than refusing the plugin: an unknown capability is one Studio would never offer anyway.
 * @param value The result.
 * @returns Returns the description, or null when the result is not one.
 */
function readDescription(value: unknown): TestAdapterDescription | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const record: Record<string, unknown> = value as Record<string, unknown>;
  if (typeof record['protocol'] !== 'string' || !Array.isArray(record['capabilities'])) {
    return null;
  }
  const toolVersion: unknown = record['toolVersion'];
  const problem: unknown = record['problem'];
  return {
    protocol: record['protocol'],
    capabilities: record['capabilities'].filter(isTestAdapterCapability),
    toolVersion: typeof toolVersion === 'string' ? toolVersion : null,
    ...(typeof problem === 'string' ? { problem } : {}),
  };
}
