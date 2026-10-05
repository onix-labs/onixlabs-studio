import { ChildProcess, spawn } from 'node:child_process';
import {
  isCompatibleVersionControlProtocol,
  isVersionControlCapability,
  VERSION_CONTROL_PROTOCOL_VERSION,
  VersionControlDescription,
  VersionControlExecutableChoice,
  VersionControlOp,
  VersionControlRequest,
  VersionControlResponse,
  VcsParams,
} from '@shared/api/version-control-protocol';
import { logger } from '../logger';
import { pidJournal } from '../pid-journal';
import { VersionControlSpec } from './version-control-descriptor';
import { VersionControlEndpoint } from './version-control-endpoint';

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
 * Holds a request awaiting its answer.
 */
interface Pending {
  readonly resolve: (response: VersionControlResponse) => void;
  readonly timer: NodeJS.Timeout;
}

/**
 * Speaks the version-control protocol to one plugin process (#815).
 *
 * Long-lived for the session, like a decoder, so the plugin's start-up cost is paid once. Every request
 * resolves — to the plugin's answer, or to a failure saying why there was none — so a plugin that dies,
 * hangs or answers a question nobody asked costs the caller one failed operation and nothing more.
 */
export class VersionControlClient implements VersionControlEndpoint {
  /**
   * Holds the plugin's identifier, for logging.
   */
  private readonly id: string;

  /**
   * Holds how to spawn the plugin.
   */
  private readonly spec: VersionControlSpec;

  /**
   * Holds the running process, or null before it starts and after it exits.
   */
  private process: ChildProcess | null = null;

  /**
   * Holds the requests awaiting answers, keyed by correlation identifier.
   */
  private readonly pending: Map<number, Pending> = new Map<number, Pending>();

  /**
   * Holds the incomplete trailing line of stdout, since a chunk may split a message in half.
   */
  private buffer: string = '';

  /**
   * Holds the next correlation identifier.
   */
  private nextId: number = 1;

  /**
   * Holds what the plugin said it was, or null before the handshake completes.
   */
  private description: VersionControlDescription | null = null;

  /**
   * Holds whether the client has been disposed, so a late exit is not reported as a failure.
   */
  private disposed: boolean = false;

  /**
   * Initializes the client. The process is not started until {@link start} is called.
   * @param id The plugin identifier, for logging.
   * @param spec How to spawn the plugin.
   */
  public constructor(id: string, spec: VersionControlSpec) {
    this.id = id;
    this.spec = spec;
  }

  /**
   * Gets whether the plugin is running and has completed its handshake.
   * @returns Returns true while the plugin can be asked things.
   */
  public get running(): boolean {
    return this.description !== null && this.process !== null;
  }

  /**
   * Starts the plugin and completes the initialize handshake.
   *
   * A plugin announcing an incompatible protocol is refused rather than spoken to: one that misreads a
   * request does something to the user's repository other than what they asked.
   * @param executable The user's choice of which tool the plugin runs, or null for the plugin's default.
   * @returns Returns what the plugin said it is, or null when it could not be started or was refused.
   */
  public async start(
    executable: VersionControlExecutableChoice | null,
  ): Promise<VersionControlDescription | null> {
    if (this.description !== null) {
      return this.description;
    }
    try {
      this.process = spawn(this.spec.command, [...this.spec.args], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: this.spec.env === undefined ? process.env : { ...process.env, ...this.spec.env },
      });
    } catch (error: unknown) {
      logger.warn('VersionControlClient', `Could not spawn '${this.id}'`, error);
      return null;
    }
    // Journalled like every other long-lived child, so one left behind by an abrupt exit is reaped on
    // the next launch (#583).
    pidJournal()?.register(this.process.pid, 'version-control', this.spec.command);

    this.process.stdout?.setEncoding('utf8');
    this.process.stdout?.on('data', (chunk: string): void => this.onData(chunk));
    this.process.stderr?.setEncoding('utf8');
    this.process.stderr?.on('data', (chunk: string): void => {
      logger.debug('VersionControlClient', `[${this.id}] ${chunk.trimEnd()}`);
    });
    this.process.on('exit', (code: number | null): void => this.onExit(code));
    this.process.on('error', (error: Error): void => {
      logger.warn('VersionControlClient', `'${this.id}' failed`, error);
      this.onExit(null);
    });

    const response: VersionControlResponse = await this.send(
      'initialize',
      undefined,
      { protocol: VERSION_CONTROL_PROTOCOL_VERSION, executable },
      HANDSHAKE_TIMEOUT_MS,
    );
    const description: VersionControlDescription | null = response.ok
      ? readDescription(response.result)
      : null;
    if (description === null) {
      logger.warn('VersionControlClient', `'${this.id}' did not initialize; discarding it`);
      this.dispose();
      return null;
    }
    if (!isCompatibleVersionControlProtocol(description.protocol)) {
      logger.warn(
        'VersionControlClient',
        `'${this.id}' speaks protocol ${description.protocol}, which this build cannot; discarding it`,
      );
      this.dispose();
      return null;
    }
    this.description = description;
    logger.info(
      'VersionControlClient',
      `'${this.id}' ready (${description.toolVersion ?? 'tool not found'}); capabilities: ${description.capabilities.join(', ') || 'none'}`,
    );
    return description;
  }

  /**
   * Asks the plugin to perform an operation.
   * @param op The operation.
   * @param root The absolute repository root it acts on, or undefined for a global operation.
   * @param params The operation's parameters.
   * @param timeoutMs How long to wait before abandoning it.
   * @returns Returns the plugin's answer, or a failure saying why there was none.
   */
  public request<Op extends VersionControlOp>(
    op: Op,
    root: string | undefined,
    params: VcsParams<Op>,
    timeoutMs: number,
  ): Promise<VersionControlResponse<Op>> {
    if (this.description === null) {
      return Promise.resolve({ id: 0, ok: false, error: `${this.id} is not running.` });
    }
    return this.send(op, root, params, timeoutMs);
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
    logger.debug('VersionControlClient', `'${this.id}' stopped`);
    if (child.exitCode !== null || child.signalCode !== null) {
      return;
    }
    const escalation: NodeJS.Timeout = setTimeout((): void => {
      if (child.exitCode === null && child.signalCode === null) {
        logger.warn('VersionControlClient', `'${this.id}' ignored SIGTERM; killing it`);
        child.kill('SIGKILL');
      }
    }, KILL_GRACE_MS);
    escalation.unref?.();
    child.once('exit', (): void => clearTimeout(escalation));
  }

  /**
   * Sends a request and waits for its answer.
   * @param op The operation.
   * @param root The repository root, or undefined for a global operation.
   * @param params The operation's parameters.
   * @param timeoutMs How long to wait before abandoning it.
   * @returns Returns the response, or a failure when the plugin is not running or did not answer.
   */
  private send(
    op: VersionControlOp,
    root: string | undefined,
    params: unknown,
    timeoutMs: number,
  ): Promise<VersionControlResponse> {
    const stdin: NodeJS.WritableStream | null = this.process?.stdin ?? null;
    const id: number = this.nextId;
    this.nextId += 1;
    if (stdin === null || this.disposed) {
      return Promise.resolve({ id, ok: false, error: `${this.id} is not running.` });
    }
    const request: VersionControlRequest = {
      id,
      op,
      ...(root === undefined ? {} : { root }),
      params: params as VersionControlRequest['params'],
    };
    return new Promise<VersionControlResponse>((resolve): void => {
      const timer: NodeJS.Timeout = setTimeout((): void => {
        this.pending.delete(id);
        logger.warn('VersionControlClient', `'${this.id}' did not answer ${op} (${id}) in time`);
        resolve({ id, ok: false, error: `${this.id} did not answer in time.` });
      }, timeoutMs);
      timer.unref?.();
      this.pending.set(id, {
        resolve: (response: VersionControlResponse): void => {
          clearTimeout(timer);
          resolve(response);
        },
        timer,
      });
      try {
        stdin.write(`${JSON.stringify(request)}\n`);
      } catch (error: unknown) {
        clearTimeout(timer);
        this.pending.delete(id);
        logger.warn('VersionControlClient', `Could not write to '${this.id}'`, error);
        resolve({ id, ok: false, error: `${this.id} could not be reached.` });
      }
    });
  }

  /**
   * Consumes stdout, dispatching each complete line as a response.
   * @param chunk The received text.
   */
  private onData(chunk: string): void {
    this.buffer += chunk;
    let newline: number = this.buffer.indexOf('\n');
    while (newline !== -1) {
      const line: string = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line.length > 0) {
        this.dispatch(line);
      }
      newline = this.buffer.indexOf('\n');
    }
  }

  /**
   * Parses one response line and hands it to whoever is waiting for it. A line that is not a
   * well-formed response, or answers nothing pending, is dropped.
   * @param line The response line.
   */
  private dispatch(line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      logger.debug('VersionControlClient', `'${this.id}' wrote a line that is not JSON`);
      return;
    }
    const response: VersionControlResponse | null = readResponse(parsed);
    if (response === null) {
      logger.debug('VersionControlClient', `'${this.id}' wrote a malformed response`);
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
      logger.warn('VersionControlClient', `'${this.id}' exited (${code ?? 'signal'})`);
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
function readResponse(value: unknown): VersionControlResponse | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const record: Record<string, unknown> = value as Record<string, unknown>;
  if (typeof record['id'] !== 'number') {
    return null;
  }
  if (record['ok'] === true) {
    return record as unknown as VersionControlResponse;
  }
  if (record['ok'] === false && typeof record['error'] === 'string') {
    return record as unknown as VersionControlResponse;
  }
  return null;
}

/**
 * Narrows an untrusted initialize result to a description, dropping capabilities this build does not
 * know rather than refusing the plugin: an unknown capability is one Studio would never offer anyway.
 * @param value The result.
 * @returns Returns the description, or null when the result is not one.
 */
function readDescription(value: unknown): VersionControlDescription | null {
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
    capabilities: record['capabilities'].filter(isVersionControlCapability),
    toolVersion: typeof toolVersion === 'string' ? toolVersion : null,
    ...(typeof problem === 'string' ? { problem } : {}),
  };
}
