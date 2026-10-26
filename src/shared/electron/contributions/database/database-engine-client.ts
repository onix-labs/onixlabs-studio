import { ChildProcess, spawn } from 'node:child_process';
import {
  DATABASE_ENGINE_PROTOCOL,
  DatabaseEngineDescription,
  DatabaseEngineInfo,
  DatabaseEngineOp,
  DatabaseEngineParams,
  DatabaseEngineRequest,
  DatabaseEngineResult,
  isCompatibleDatabaseEngineProtocol,
} from '@shared/api/database-engine-protocol';
import { logger } from '../../logger';
import { pidJournal } from '../../pid-journal';
import { pluginEnvironment } from '../../plugin-environment';
import type { NodeRuntimeSpec } from '../plugins/plugin-loader';

/**
 * How long a plugin has to answer `initialize` before it is given up on.
 */
const HANDSHAKE_TIMEOUT_MS: number = 15_000;

/**
 * How long an ordinary request may take: a connect over a slow network, an expand over a large
 * catalogue. Longer means the plugin is stuck.
 */
const REQUEST_TIMEOUT_MS: number = 90_000;

/**
 * How long a query may run. A report over a large table legitimately takes minutes; one that outlasts
 * this is answered as failed, and the user can cancel long before it.
 */
const EXECUTE_TIMEOUT_MS: number = 60 * 60_000;

/**
 * How long a plugin is given to exit after SIGTERM before it is killed.
 */
const KILL_GRACE_MS: number = 2_000;

/**
 * What a request came back with: its result, or why there is none.
 */
export type DatabaseEngineOutcome<T> =
  { readonly ok: true; readonly result: T } | { readonly ok: false; readonly error: string };

/**
 * A request waiting for its answer.
 */
interface Pending {
  readonly resolve: (outcome: DatabaseEngineOutcome<unknown>) => void;
  readonly timer: NodeJS.Timeout;
}

/**
 * One database engine's plugin process (#1095): Studio speaks the database-engine protocol to it, and
 * it speaks to its database with the driver it bundles.
 *
 * The process is started on first use and again on the next use after it exits, so a plugin that
 * crashed costs the call in flight rather than the feature — though its sessions go with it, and a
 * connection is opened afresh. Every call answers with an outcome, never a throw.
 */
export class DatabaseEngineClient {
  /**
   * Holds the process while it runs.
   */
  private process: ChildProcess | null = null;

  /**
   * Holds the plugin's description once it has initialised.
   */
  private description: DatabaseEngineDescription | null = null;

  /**
   * Holds the start in progress, so concurrent calls share one.
   */
  private starting: Promise<boolean> | null = null;

  /**
   * Holds the requests waiting for answers, by id.
   */
  private readonly pending: Map<number, Pending> = new Map<number, Pending>();

  /**
   * Holds the partial line read so far.
   */
  private buffer: string = '';

  /**
   * Holds the next request id.
   */
  private nextId: number = 1;

  /**
   * Holds whether the client has been disposed, after which it never starts again.
   */
  private disposed: boolean = false;

  /**
   * Holds the callbacks told when the process exits, so the host can forget its sessions.
   */
  private readonly exitListeners: Set<() => void> = new Set<() => void>();

  /**
   * Initializes a new instance of the {@link DatabaseEngineClient} class.
   * @param id The engine's id, for the log.
   * @param spec How to run the plugin process.
   */
  public constructor(
    public readonly id: string,
    private readonly spec: NodeRuntimeSpec,
  ) {}

  /**
   * Starts the plugin if need be and answers with what the engine says about itself.
   * @returns Returns the engine's description, or null when the plugin could not start.
   */
  public async info(): Promise<DatabaseEngineInfo | null> {
    return (await this.ensureStarted()) ? (this.description?.engine ?? null) : null;
  }

  /**
   * Calls one operation, starting the plugin when it is not running.
   * @param op The operation.
   * @param params Its parameters.
   * @returns Returns the outcome; never rejects.
   */
  public async call<Op extends DatabaseEngineOp>(
    op: Op,
    params: DatabaseEngineParams<Op>,
  ): Promise<DatabaseEngineOutcome<DatabaseEngineResult<Op>>> {
    if (!(await this.ensureStarted())) {
      return { ok: false, error: `The ${this.id} engine could not be started.` };
    }
    const outcome: DatabaseEngineOutcome<unknown> = await this.send(
      op,
      params,
      op === 'execute' ? EXECUTE_TIMEOUT_MS : REQUEST_TIMEOUT_MS,
    );
    if (!outcome.ok) {
      logger.debug('DatabaseEngineClient', `'${this.id}' ${op} failed: ${outcome.error}`);
    }
    return outcome as DatabaseEngineOutcome<DatabaseEngineResult<Op>>;
  }

  /**
   * Registers a callback told whenever the process exits.
   * @param listener The callback.
   * @returns Returns a function that unregisters it.
   */
  public onExit(listener: () => void): () => void {
    this.exitListeners.add(listener);
    return (): void => {
      this.exitListeners.delete(listener);
    };
  }

  /**
   * Stops the process; the next call starts it again, from what is installed then.
   */
  public restart(): void {
    this.stopProcess();
  }

  /**
   * Stops the plugin process for good.
   */
  public dispose(): void {
    this.disposed = true;
    this.stopProcess();
    this.exitListeners.clear();
  }

  /**
   * Starts the plugin when it is not running, sharing one start between concurrent callers.
   * @returns Returns true when it is running and initialised.
   */
  private ensureStarted(): Promise<boolean> {
    if (this.description !== null) {
      return Promise.resolve(true);
    }
    if (this.disposed) {
      return Promise.resolve(false);
    }
    this.starting ??= this.startProcess().finally((): void => {
      this.starting = null;
    });
    return this.starting;
  }

  /**
   * Spawns the plugin and performs the handshake.
   * @returns Returns true when it initialised with a protocol this build speaks.
   */
  private async startProcess(): Promise<boolean> {
    try {
      this.process = spawn(this.spec.command, [...this.spec.args], {
        stdio: ['pipe', 'pipe', 'pipe'],
        // Only what a program needs to run, never the user's whole shell (audit S6).
        env: pluginEnvironment(this.spec.env),
      });
    } catch (error: unknown) {
      logger.warn('DatabaseEngineClient', `Could not spawn '${this.id}'`, error);
      return false;
    }
    // Journalled like every other long-lived child, so one left behind by an abrupt exit is reaped on
    // the next launch.
    pidJournal()?.register(this.process.pid, 'database-engine', this.spec.command);
    const child: ChildProcess = this.process;
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string): void => this.onData(chunk));
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string): void => {
      logger.debug('DatabaseEngineClient', `[${this.id}] ${chunk.trimEnd()}`);
    });
    child.on('exit', (code: number | null): void => this.handleExit(child, code));
    child.on('error', (error: Error): void => {
      logger.warn('DatabaseEngineClient', `'${this.id}' failed`, error);
      this.handleExit(child, null);
    });

    const outcome: DatabaseEngineOutcome<unknown> = await this.send(
      'initialize',
      { protocol: DATABASE_ENGINE_PROTOCOL },
      HANDSHAKE_TIMEOUT_MS,
    );
    const description: DatabaseEngineDescription | null = outcome.ok
      ? readDescription(outcome.result)
      : null;
    if (description === null || !isCompatibleDatabaseEngineProtocol(description.protocol)) {
      logger.warn(
        'DatabaseEngineClient',
        description === null
          ? `'${this.id}' did not initialise; stopping it`
          : `'${this.id}' speaks protocol ${description.protocol}, which this build cannot; stopping it`,
      );
      this.stopProcess();
      return false;
    }
    this.description = description;
    logger.info(
      'DatabaseEngineClient',
      `'${this.id}' ready: ${description.engine.displayName}; capabilities: ${description.engine.capabilities.join(', ') || 'none'}`,
    );
    return true;
  }

  /**
   * Writes one request and waits for its answer.
   * @param op The operation.
   * @param params Its parameters.
   * @param timeoutMs How long to wait.
   * @returns Returns the outcome.
   */
  private send(
    op: DatabaseEngineOp,
    params: unknown,
    timeoutMs: number,
  ): Promise<DatabaseEngineOutcome<unknown>> {
    const stdin: NodeJS.WritableStream | null = this.process?.stdin ?? null;
    const id: number = this.nextId;
    this.nextId += 1;
    if (stdin === null) {
      return Promise.resolve({ ok: false, error: `The ${this.id} engine is not running.` });
    }
    const request: DatabaseEngineRequest = {
      id,
      op,
      params: params as DatabaseEngineRequest['params'],
    };
    return new Promise<DatabaseEngineOutcome<unknown>>(
      (resolve: (outcome: DatabaseEngineOutcome<unknown>) => void): void => {
        const timer: NodeJS.Timeout = setTimeout((): void => {
          this.pending.delete(id);
          logger.warn('DatabaseEngineClient', `'${this.id}' did not answer ${op} (${id}) in time`);
          resolve({ ok: false, error: `The ${this.id} engine did not answer in time.` });
        }, timeoutMs);
        timer.unref?.();
        this.pending.set(id, {
          resolve: (outcome: DatabaseEngineOutcome<unknown>): void => {
            clearTimeout(timer);
            resolve(outcome);
          },
          timer,
        });
        try {
          stdin.write(`${JSON.stringify(request)}\n`);
        } catch (error: unknown) {
          clearTimeout(timer);
          this.pending.delete(id);
          logger.warn('DatabaseEngineClient', `Could not write to '${this.id}'`, error);
          resolve({ ok: false, error: `The ${this.id} engine could not be reached.` });
        }
      },
    );
  }

  /**
   * Splits what the plugin wrote into lines.
   * @param chunk The text read.
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
   * Routes one answer line to its request.
   * @param line The line.
   */
  private dispatch(line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      logger.debug('DatabaseEngineClient', `'${this.id}' wrote a line that is not JSON`);
      return;
    }
    const record: Record<string, unknown> =
      typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
    const id: unknown = record['id'];
    const entry: Pending | undefined = typeof id === 'number' ? this.pending.get(id) : undefined;
    if (entry === undefined) {
      return;
    }
    this.pending.delete(id as number);
    entry.resolve(
      record['ok'] === true
        ? { ok: true, result: record['result'] }
        : { ok: false, error: typeof record['error'] === 'string' ? record['error'] : 'failed' },
    );
  }

  /**
   * Notes that the process exited, failing what was waiting on it; the next call starts it again.
   * @param child The process that exited.
   * @param code Its exit code, or null for a signal.
   */
  private handleExit(child: ChildProcess, code: number | null): void {
    if (this.process !== child) {
      return;
    }
    if (!this.disposed) {
      logger.warn('DatabaseEngineClient', `'${this.id}' exited (${code ?? 'signal'})`);
    }
    pidJournal()?.unregister(child.pid);
    this.process = null;
    this.description = null;
    this.failPending(`The ${this.id} engine stopped.`);
    for (const listener of [...this.exitListeners]) {
      listener();
    }
  }

  /**
   * Stops the process, escalating to SIGKILL when it ignores SIGTERM.
   */
  private stopProcess(): void {
    const child: ChildProcess | null = this.process;
    this.failPending(`The ${this.id} engine was stopped.`);
    this.description = null;
    if (child === null) {
      return;
    }
    this.process = null;
    pidJournal()?.unregister(child.pid);
    for (const listener of [...this.exitListeners]) {
      listener();
    }
    child.stdin?.end();
    child.kill();
    if (child.exitCode !== null || child.signalCode !== null) {
      return;
    }
    const escalation: NodeJS.Timeout = setTimeout((): void => {
      if (child.exitCode === null && child.signalCode === null) {
        logger.warn('DatabaseEngineClient', `'${this.id}' ignored SIGTERM; killing it`);
        child.kill('SIGKILL');
      }
    }, KILL_GRACE_MS);
    escalation.unref?.();
    child.once('exit', (): void => clearTimeout(escalation));
  }

  /**
   * Fails every request still waiting.
   * @param error Why.
   */
  private failPending(error: string): void {
    for (const [id, entry] of [...this.pending]) {
      clearTimeout(entry.timer);
      this.pending.delete(id);
      entry.resolve({ ok: false, error });
    }
  }
}

/**
 * Reads a plugin's description out of its `initialize` answer, keeping only an engine Studio can use:
 * one that names itself and its language and lists its connection fields.
 * @param value The answer.
 * @returns Returns the description, or null when it is not one.
 */
export function readDescription(value: unknown): DatabaseEngineDescription | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const record: Record<string, unknown> = value as Record<string, unknown>;
  const engine: unknown = record['engine'];
  if (typeof record['protocol'] !== 'string' || typeof engine !== 'object' || engine === null) {
    return null;
  }
  const info: Record<string, unknown> = engine as Record<string, unknown>;
  if (
    typeof info['id'] !== 'string' ||
    typeof info['displayName'] !== 'string' ||
    typeof info['language'] !== 'string' ||
    !Array.isArray(info['capabilities']) ||
    !Array.isArray(info['connectionFields'])
  ) {
    return null;
  }
  return { protocol: record['protocol'], engine: engine as DatabaseEngineInfo };
}
