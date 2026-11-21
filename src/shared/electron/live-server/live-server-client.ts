import type { ChildProcess } from 'node:child_process';
import {
  isCompatibleLiveServerProtocol,
  LIVE_SERVER_PROTOCOL_VERSION,
  LiveServerDescription,
  LiveServerOp,
  LiveServerParams,
  LiveServerRequest,
  LiveServerResponse,
} from '@shared/api/live-server-protocol';
import { Launcher, launchStudioOwned } from '../process/launch';
import { logger } from '../logger';
import { LineSplitter } from '../line-splitter';
import { pluginEnvironment } from '../plugin-environment';
import { pidJournal } from '../pid-journal';
import { LiveServerSpec } from './live-server-descriptor';
import { LiveServerEndpoint } from './live-server-endpoint';

/**
 * Starts this file's programs: Studio's own, which act on no repository (#1504). A live server runs
 * none of a folder's code; it reads the folder's files and hands them to a browser.
 */
const launch: Launcher = launchStudioOwned('plugin-process');

/**
 * Specifies how long the initialize handshake may take.
 */
const HANDSHAKE_TIMEOUT_MS: number = 10_000;

/**
 * Specifies the grace period, in milliseconds, between SIGTERM and SIGKILL when stopping a plugin.
 */
const KILL_GRACE_MS: number = 2_000;

/**
 * Specifies the longest stdout line the client buffers. Every answer is a few dozen characters.
 */
const MAX_LINE_LENGTH: number = 64 * 1024;

/**
 * Holds a request awaiting its answer.
 */
interface Pending {
  readonly resolve: (response: LiveServerResponse) => void;
  readonly timer: NodeJS.Timeout;
}

/**
 * Speaks the live-server protocol to one plugin process (#1062).
 *
 * Long-lived for the session, so the servers it runs outlive any one request. Every request resolves —
 * to the plugin's answer, or to a failure saying why there was none — and the plugin exiting is
 * reported through `onExit`, because the servers it ran went with it.
 */
export class LiveServerClient implements LiveServerEndpoint {
  /**
   * Holds the plugin's identifier, for logging.
   */
  private readonly id: string;

  /**
   * Holds how to spawn the plugin.
   */
  private readonly spec: LiveServerSpec;

  /**
   * Holds what to call when the plugin exits on its own.
   */
  private readonly onExited: () => void;

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
  private description: LiveServerDescription | null = null;

  /**
   * Holds whether the client has been disposed, so a late exit is not reported as a failure.
   */
  private disposed: boolean = false;

  /**
   * Initializes the client. The process is not started until {@link start} is called.
   * @param id The plugin identifier, for logging.
   * @param spec How to spawn the plugin.
   * @param onExited Called when the plugin exits without being stopped.
   */
  public constructor(id: string, spec: LiveServerSpec, onExited: () => void) {
    this.id = id;
    this.spec = spec;
    this.onExited = onExited;
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
  public async start(): Promise<LiveServerDescription | null> {
    if (this.description !== null) {
      return this.description;
    }
    try {
      this.process = launch.spawn(this.spec.command, [...this.spec.args], {
        stdio: ['pipe', 'pipe', 'pipe'],
        // Only what a program needs to run, never the user's whole shell (audit S6).
        env: pluginEnvironment(this.spec.env),
      });
    } catch (error: unknown) {
      logger.warn('LiveServerClient', `Could not spawn '${this.id}'`, error);
      return null;
    }
    // Journalled like every other long-lived child, so one left behind by an abrupt exit is reaped on
    // the next launch (#583) — and its ports with it.
    pidJournal()?.register(this.process.pid, 'live-server', this.spec.command);

    this.process.stdout?.setEncoding('utf8');
    const lines: LineSplitter = new LineSplitter({
      trim: true,
      maxLineLength: MAX_LINE_LENGTH,
      onLine: (line: string): void => this.dispatch(line),
      onOversized: (): void => this.failPending(`${this.id} sent an answer too large to read.`),
    });
    this.process.stdout?.on('data', (chunk: string): void => lines.push(chunk));
    this.process.stderr?.setEncoding('utf8');
    this.process.stderr?.on('data', (chunk: string): void => {
      logger.debug('LiveServerClient', `[${this.id}] ${chunk.trimEnd()}`);
    });
    this.process.on('exit', (code: number | null): void => this.onExit(code));
    this.process.on('error', (error: Error): void => {
      logger.warn('LiveServerClient', `'${this.id}' failed`, error);
      this.onExit(null);
    });

    const response: LiveServerResponse = await this.send(
      'initialize',
      { protocol: LIVE_SERVER_PROTOCOL_VERSION },
      HANDSHAKE_TIMEOUT_MS,
    );
    const description: LiveServerDescription | null = response.ok
      ? readDescription(response.result)
      : null;
    if (description === null || !isCompatibleLiveServerProtocol(description.protocol)) {
      logger.warn('LiveServerClient', `'${this.id}' did not initialize compatibly; discarding it`);
      this.dispose();
      return null;
    }
    this.description = description;
    logger.info('LiveServerClient', `'${this.id}' ready (protocol ${description.protocol})`);
    return description;
  }

  /**
   * Asks the plugin to perform an operation.
   * @param op The operation.
   * @param params The operation's parameters.
   * @param timeoutMs How long to wait before abandoning it.
   * @returns Returns the plugin's answer, or a failure saying why there was none.
   */
  public async request<Op extends LiveServerOp>(
    op: Op,
    params: LiveServerParams<Op>,
    timeoutMs: number,
  ): Promise<LiveServerResponse<Op>> {
    if (this.description === null) {
      return { id: 0, ok: false, error: `${this.id} is not running.` };
    }
    return await this.send(op, params, timeoutMs);
  }

  /**
   * Stops the plugin and fails anything still in flight. Closing its stdin is how it is told the
   * session is over, which closes every port it holds; SIGTERM, then SIGKILL after a grace period, for
   * a plugin that ignores it.
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
    logger.debug('LiveServerClient', `'${this.id}' stopped`);
    if (child.exitCode !== null || child.signalCode !== null) {
      return;
    }
    const escalation: NodeJS.Timeout = setTimeout((): void => {
      if (child.exitCode === null && child.signalCode === null) {
        logger.warn('LiveServerClient', `'${this.id}' ignored SIGTERM; killing it`);
        child.kill('SIGKILL');
      }
    }, KILL_GRACE_MS);
    escalation.unref?.();
    child.once('exit', (): void => clearTimeout(escalation));
  }

  /**
   * Sends a request and waits for its answer.
   * @param op The operation.
   * @param params The operation's parameters.
   * @param timeoutMs How long to wait before abandoning it.
   * @returns Returns the response, or a failure when the plugin is not running or did not answer.
   */
  private send(op: LiveServerOp, params: unknown, timeoutMs: number): Promise<LiveServerResponse> {
    const id: number = this.nextId;
    this.nextId += 1;
    if (this.process?.stdin === undefined || this.process.stdin === null || this.disposed) {
      return Promise.resolve({ id, ok: false, error: `${this.id} is not running.` });
    }
    const request: LiveServerRequest = {
      id,
      op,
      params: params as LiveServerRequest['params'],
    };
    return new Promise<LiveServerResponse>((resolve): void => {
      const timer: NodeJS.Timeout = setTimeout((): void => {
        this.pending.delete(id);
        logger.warn('LiveServerClient', `'${this.id}' did not answer ${op} (${id}) in time`);
        resolve({ id, ok: false, error: `${this.id} did not answer in time.` });
      }, timeoutMs);
      timer.unref?.();
      this.pending.set(id, {
        resolve: (response: LiveServerResponse): void => {
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
  private write(message: LiveServerRequest): boolean {
    try {
      this.process?.stdin?.write(`${JSON.stringify(message)}\n`);
      return this.process !== null;
    } catch (error: unknown) {
      logger.warn('LiveServerClient', `Could not write to '${this.id}'`, error);
      return false;
    }
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
      logger.debug('LiveServerClient', `'${this.id}' wrote a line that is not JSON`);
      return;
    }
    const response: LiveServerResponse | null = readResponse(parsed);
    if (response === null) {
      logger.debug('LiveServerClient', `'${this.id}' wrote a malformed message`);
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
   * Handles the plugin exiting, failing everything still in flight and saying so when it was not asked
   * to stop.
   * @param code The exit code, or null when it was killed.
   */
  private onExit(code: number | null): void {
    if (this.process !== null) {
      pidJournal()?.unregister(this.process.pid);
    }
    const wasRunning: boolean = this.process !== null;
    this.process = null;
    this.description = null;
    this.failPending(`${this.id} exited.`);
    if (!this.disposed && wasRunning) {
      logger.warn('LiveServerClient', `'${this.id}' exited (${code ?? 'signal'})`);
      this.onExited();
    }
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
function readResponse(value: unknown): LiveServerResponse | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const record: Record<string, unknown> = value as Record<string, unknown>;
  if (typeof record['id'] !== 'number') {
    return null;
  }
  if (record['ok'] === true || (record['ok'] === false && typeof record['error'] === 'string')) {
    return record as unknown as LiveServerResponse;
  }
  return null;
}

/**
 * Narrows an untrusted initialize result to a description.
 * @param value The result.
 * @returns Returns the description, or null when the result is not one.
 */
function readDescription(value: unknown): LiveServerDescription | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const protocol: unknown = (value as Record<string, unknown>)['protocol'];
  return typeof protocol === 'string' ? { protocol } : null;
}
