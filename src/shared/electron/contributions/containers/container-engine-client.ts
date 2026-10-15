import { ChildProcess, spawn } from 'node:child_process';
import {
  CONTAINER_ENGINE_OP_CAPABILITY,
  CONTAINER_ENGINE_PROTOCOL_VERSION,
  ContainerEngineCapability,
  ContainerEngineDescription,
  ContainerEngineOp,
  ContainerEngineParams,
  ContainerEngineRequest,
  ContainerEngineResult,
  ContainerLogs,
  isCompatibleContainerEngineProtocol,
  isContainerEngineCapability,
} from '@shared/api/container-engine-protocol';
import {
  ContainerEvent,
  ContainerStatus,
  ContainerSummary,
  ImageSummary,
} from '@shared/api/container-types';
import { logger } from '../../logger';
import { pidJournal } from '../../pid-journal';
import type { NodeRuntimeSpec } from '../plugins/plugin-loader';
import { ContainerEngine, StreamHandle } from './container-engine';

/**
 * How long a plugin has to answer `initialize` before it is given up on.
 */
const HANDSHAKE_TIMEOUT_MS: number = 10_000;

/**
 * How long an ordinary request may take. Engine calls are local and quick; a longer wait means the
 * plugin is stuck, and the surface would rather show nothing than hang.
 */
const REQUEST_TIMEOUT_MS: number = 30_000;

/**
 * How long a plugin is given to exit after SIGTERM before it is killed.
 */
const KILL_GRACE_MS: number = 2_000;

/**
 * A request waiting for its answer.
 */
interface Pending {
  readonly resolve: (outcome: Outcome) => void;
  readonly timer: NodeJS.Timeout;
}

/**
 * What a request came back with: its result, or why there is none.
 */
type Outcome =
  { readonly ok: true; readonly result: unknown } | { readonly ok: false; readonly error: string };

/**
 * The container engine slot served by a plugin process (#973): Studio speaks the container-engine
 * protocol to the plugin, and the plugin speaks to its engine over the socket Studio resolved for it.
 *
 * The process is started on first use and started again on the next use after it exits, so a plugin
 * that crashed costs one failed call rather than the feature. Every call is safe when it cannot be
 * served: an empty list, `false`, an unavailable status — the surface shows "not running", never an
 * error it cannot act on. Event watchers outlive a restart: the stream is asked for again whenever the
 * plugin comes back while someone is watching.
 */
export class ContainerEngineClient implements ContainerEngine {
  /**
   * Holds the process while it runs.
   */
  private process: ChildProcess | null = null;

  /**
   * Holds the plugin's description once it has initialised.
   */
  private description: ContainerEngineDescription | null = null;

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
   * Holds the event listeners, while anyone is watching.
   */
  private readonly listeners: Set<(event: ContainerEvent) => void> = new Set<
    (event: ContainerEvent) => void
  >();

  /**
   * Holds whether the client has been disposed, after which it never starts again.
   */
  private disposed: boolean = false;

  /**
   * Initializes a new instance of the {@link ContainerEngineClient} class.
   * @param id The engine's id, for the log.
   * @param spec How to run the plugin process.
   * @param socketPath The engine's socket, resolved through the `container.socket` permission.
   */
  public constructor(
    private readonly id: string,
    private readonly spec: NodeRuntimeSpec,
    private readonly socketPath: string,
  ) {}

  /**
   * Lists the containers.
   * @returns Returns them, or none when the plugin cannot answer.
   */
  public async listContainers(): Promise<ContainerSummary[]> {
    return [...((await this.call('listContainers', {})) ?? [])];
  }

  /**
   * Lists the images.
   * @returns Returns them, or none when the plugin cannot answer.
   */
  public async listImages(): Promise<ImageSummary[]> {
    return [...((await this.call('listImages', {})) ?? [])];
  }

  /**
   * Starts a container.
   * @param id The container id.
   * @returns Returns true when the engine accepted it.
   */
  public async start(id: string): Promise<boolean> {
    return (await this.call('start', { id })) === true;
  }

  /**
   * Stops a container.
   * @param id The container id.
   * @returns Returns true when the engine accepted it.
   */
  public async stop(id: string): Promise<boolean> {
    return (await this.call('stop', { id })) === true;
  }

  /**
   * Removes a container.
   * @param id The container id.
   * @returns Returns true when the engine accepted it.
   */
  public async remove(id: string): Promise<boolean> {
    return (await this.call('remove', { id })) === true;
  }

  /**
   * Reads a container's most recent log lines.
   * @param id The container id.
   * @param tail How many lines, at most.
   * @returns Returns the lines, or none when the plugin cannot answer.
   */
  public async logs(id: string, tail: number): Promise<ContainerLogs> {
    return (await this.call('logs', { id, tail })) ?? { lines: [], truncated: false };
  }

  /**
   * Reports whether the engine is reachable.
   * @returns Returns the status; unavailable when the plugin cannot answer.
   */
  public async status(): Promise<ContainerStatus> {
    return (await this.call('status', {})) ?? { available: false };
  }

  /**
   * Watches the engine's events. The plugin is asked to send them while anyone is watching, and asked
   * again whenever it restarts.
   * @param onEvent Receives each event.
   * @returns Returns the handle that stops watching.
   */
  public watch(onEvent: (event: ContainerEvent) => void): StreamHandle {
    this.listeners.add(onEvent);
    if (this.listeners.size === 1) {
      // A running plugin is asked now; one not yet running asks for itself as it starts, since it
      // takes up any watch that is open — asking here as well would send every event twice.
      if (this.description !== null) {
        void this.call('watchStart', {});
      } else {
        void this.ensureStarted();
      }
    }
    return {
      close: (): void => {
        this.listeners.delete(onEvent);
        if (this.listeners.size === 0 && this.description !== null) {
          void this.call('watchStop', {});
        }
      },
    };
  }

  /**
   * Stops the plugin process for good.
   */
  public dispose(): void {
    this.disposed = true;
    this.listeners.clear();
    this.stopProcess();
  }

  /**
   * Makes a call, starting the plugin when it is not running. Resolves null — never throws — when the
   * call cannot be served: the plugin could not start, does not offer the operation, failed, or did not
   * answer in time.
   * @param op The operation.
   * @param params Its parameters.
   * @returns Returns the result, or null.
   */
  private async call<Op extends ContainerEngineOp>(
    op: Op,
    params: ContainerEngineParams<Op>,
  ): Promise<ContainerEngineResult<Op> | null> {
    if (!(await this.ensureStarted())) {
      return null;
    }
    const needs: ContainerEngineCapability | null = CONTAINER_ENGINE_OP_CAPABILITY[op];
    if (needs !== null && !this.description!.capabilities.includes(needs)) {
      logger.debug('ContainerEngineClient', `'${this.id}' does not offer ${op}`);
      return null;
    }
    const outcome: Outcome = await this.send(op, params, REQUEST_TIMEOUT_MS);
    if (!outcome.ok) {
      logger.debug('ContainerEngineClient', `'${this.id}' ${op} failed: ${outcome.error}`);
      return null;
    }
    return outcome.result as ContainerEngineResult<Op>;
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
        env: this.spec.env === undefined ? process.env : { ...process.env, ...this.spec.env },
      });
    } catch (error: unknown) {
      logger.warn('ContainerEngineClient', `Could not spawn '${this.id}'`, error);
      return false;
    }
    // Journalled like every other long-lived child, so one left behind by an abrupt exit is reaped on
    // the next launch.
    pidJournal()?.register(this.process.pid, 'container-engine', this.spec.command);
    const child: ChildProcess = this.process;
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string): void => this.onData(chunk));
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string): void => {
      logger.debug('ContainerEngineClient', `[${this.id}] ${chunk.trimEnd()}`);
    });
    child.on('exit', (code: number | null): void => this.onExit(child, code));
    child.on('error', (error: Error): void => {
      logger.warn('ContainerEngineClient', `'${this.id}' failed`, error);
      this.onExit(child, null);
    });

    const outcome: Outcome = await this.send(
      'initialize',
      { protocol: CONTAINER_ENGINE_PROTOCOL_VERSION, socketPath: this.socketPath },
      HANDSHAKE_TIMEOUT_MS,
    );
    const description: ContainerEngineDescription | null = outcome.ok
      ? readDescription(outcome.result)
      : null;
    if (description === null || !isCompatibleContainerEngineProtocol(description.protocol)) {
      logger.warn(
        'ContainerEngineClient',
        description === null
          ? `'${this.id}' did not initialise; stopping it`
          : `'${this.id}' speaks protocol ${description.protocol}, which this build cannot; stopping it`,
      );
      this.stopProcess();
      return false;
    }
    this.description = description;
    logger.info(
      'ContainerEngineClient',
      `'${this.id}' ready; capabilities: ${description.capabilities.join(', ') || 'none'}`,
    );
    // A watch that was open before a restart is taken up again by the new process.
    if (this.listeners.size > 0) {
      void this.send('watchStart', {}, REQUEST_TIMEOUT_MS);
    }
    return true;
  }

  /**
   * Writes one request and waits for its answer.
   * @param op The operation.
   * @param params Its parameters.
   * @param timeoutMs How long to wait.
   * @returns Returns the outcome.
   */
  private send(op: ContainerEngineOp, params: unknown, timeoutMs: number): Promise<Outcome> {
    const stdin: NodeJS.WritableStream | null = this.process?.stdin ?? null;
    const id: number = this.nextId;
    this.nextId += 1;
    if (stdin === null) {
      return Promise.resolve({ ok: false, error: `${this.id} is not running.` });
    }
    const request: ContainerEngineRequest = {
      id,
      op,
      params: params as ContainerEngineRequest['params'],
    };
    return new Promise<Outcome>((resolve: (outcome: Outcome) => void): void => {
      const timer: NodeJS.Timeout = setTimeout((): void => {
        this.pending.delete(id);
        logger.warn('ContainerEngineClient', `'${this.id}' did not answer ${op} (${id}) in time`);
        resolve({ ok: false, error: `${this.id} did not answer in time.` });
      }, timeoutMs);
      timer.unref?.();
      this.pending.set(id, {
        resolve: (outcome: Outcome): void => {
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
        logger.warn('ContainerEngineClient', `Could not write to '${this.id}'`, error);
        resolve({ ok: false, error: `${this.id} could not be reached.` });
      }
    });
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
   * Routes one line: an event to the watchers, an answer to its request.
   * @param line The line.
   */
  private dispatch(line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      logger.debug('ContainerEngineClient', `'${this.id}' wrote a line that is not JSON`);
      return;
    }
    const record: Record<string, unknown> =
      typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
    if (record['type'] === 'event') {
      const event: ContainerEvent | null = readEvent(record['event']);
      if (event !== null) {
        for (const listener of [...this.listeners]) {
          listener(event);
        }
      }
      return;
    }
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
  private onExit(child: ChildProcess, code: number | null): void {
    if (this.process !== child) {
      return;
    }
    if (!this.disposed) {
      logger.warn('ContainerEngineClient', `'${this.id}' exited (${code ?? 'signal'})`);
    }
    pidJournal()?.unregister(child.pid);
    this.process = null;
    this.description = null;
    this.failPending(`${this.id} exited.`);
  }

  /**
   * Stops the process, escalating to SIGKILL when it ignores SIGTERM.
   */
  private stopProcess(): void {
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
    if (child.exitCode !== null || child.signalCode !== null) {
      return;
    }
    const escalation: NodeJS.Timeout = setTimeout((): void => {
      if (child.exitCode === null && child.signalCode === null) {
        logger.warn('ContainerEngineClient', `'${this.id}' ignored SIGTERM; killing it`);
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
 * Reads a plugin's description out of its `initialize` answer.
 * @param value The answer.
 * @returns Returns the description, or null when it is not one.
 */
export function readDescription(value: unknown): ContainerEngineDescription | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const record: Record<string, unknown> = value as Record<string, unknown>;
  if (typeof record['protocol'] !== 'string' || !Array.isArray(record['capabilities'])) {
    return null;
  }
  return {
    protocol: record['protocol'],
    capabilities: record['capabilities'].filter(isContainerEngineCapability),
  };
}

/**
 * Reads an event out of an event line.
 * @param value The event.
 * @returns Returns the event, or null when it is not one.
 */
function readEvent(value: unknown): ContainerEvent | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const record: Record<string, unknown> = value as Record<string, unknown>;
  return {
    type: typeof record['type'] === 'string' ? record['type'] : '',
    action: typeof record['action'] === 'string' ? record['action'] : '',
    id: typeof record['id'] === 'string' ? record['id'] : '',
  };
}
