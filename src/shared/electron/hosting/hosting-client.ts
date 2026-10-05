import { ChildProcess, spawn } from 'node:child_process';
import {
  HOSTING_PROTOCOL_VERSION,
  HostingAuthMode,
  HostingCredentialAnswer,
  HostingDescription,
  HostingOp,
  HostingParams,
  HostingRequest,
  HostingResponse,
  isCompatibleHostingProtocol,
  isHostingCapability,
} from '@shared/api/hosting-protocol';
import { logger } from '../logger';
import { pidJournal } from '../pid-journal';
import { HostingSpec } from './hosting-descriptor';
import { HostingCredentialSource, HostingEndpoint } from './hosting-endpoint';

/**
 * Specifies how long the initialize handshake may take.
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
  readonly resolve: (response: HostingResponse) => void;
  readonly timer: NodeJS.Timeout;
}

/**
 * Speaks the hosting protocol to one plugin process (#819).
 *
 * The version-control client's shape (#815), plus one thing a host needs that a version-control system
 * does not: the plugin may ask for a host's credential mid-request. The credential is fetched from
 * Studio's store only then and written straight to the plugin, so it never sits in the plugin's
 * configuration or on disk beside it — the same round-trip a harness makes for its API key.
 *
 * Every request resolves — to the plugin's answer, or to a failure saying why there was none.
 */
export class HostingClient implements HostingEndpoint {
  /**
   * Holds the plugin's identifier, for logging.
   */
  private readonly id: string;

  /**
   * Holds how to spawn the plugin.
   */
  private readonly spec: HostingSpec;

  /**
   * Holds where the plugin's credential requests are answered from.
   */
  private readonly credentials: HostingCredentialSource;

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
  private description: HostingDescription | null = null;

  /**
   * Holds whether the client has been disposed, so a late exit is not reported as a failure.
   */
  private disposed: boolean = false;

  /**
   * Initializes the client. The process is not started until {@link start} is called.
   * @param id The plugin identifier, for logging.
   * @param spec How to spawn the plugin.
   * @param credentials Where the plugin's credential requests are answered from.
   */
  public constructor(id: string, spec: HostingSpec, credentials: HostingCredentialSource) {
    this.id = id;
    this.spec = spec;
    this.credentials = credentials;
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
   * @param auth The user's sign-in choice for each host that has one.
   * @returns Returns what the plugin said it is, or null when it could not be started or was refused.
   */
  public async start(
    auth: Readonly<Record<string, HostingAuthMode>>,
  ): Promise<HostingDescription | null> {
    if (this.description !== null) {
      return this.description;
    }
    try {
      this.process = spawn(this.spec.command, [...this.spec.args], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: this.spec.env === undefined ? process.env : { ...process.env, ...this.spec.env },
      });
    } catch (error: unknown) {
      logger.warn('HostingClient', `Could not spawn '${this.id}'`, error);
      return null;
    }
    pidJournal()?.register(this.process.pid, 'hosting', this.spec.command);

    this.process.stdout?.setEncoding('utf8');
    this.process.stdout?.on('data', (chunk: string): void => this.onData(chunk));
    this.process.stderr?.setEncoding('utf8');
    this.process.stderr?.on('data', (chunk: string): void => {
      logger.debug('HostingClient', `[${this.id}] ${chunk.trimEnd()}`);
    });
    this.process.on('exit', (code: number | null): void => this.onExit(code));
    this.process.on('error', (error: Error): void => {
      logger.warn('HostingClient', `'${this.id}' failed`, error);
      this.onExit(null);
    });

    const response: HostingResponse = await this.send(
      'initialize',
      { protocol: HOSTING_PROTOCOL_VERSION, auth },
      HANDSHAKE_TIMEOUT_MS,
    );
    const description: HostingDescription | null = response.ok
      ? readDescription(response.result)
      : null;
    if (description === null) {
      logger.warn('HostingClient', `'${this.id}' did not initialize; discarding it`);
      this.dispose();
      return null;
    }
    if (!isCompatibleHostingProtocol(description.protocol)) {
      logger.warn(
        'HostingClient',
        `'${this.id}' speaks protocol ${description.protocol}, which this build cannot; discarding it`,
      );
      this.dispose();
      return null;
    }
    this.description = description;
    logger.info(
      'HostingClient',
      `'${this.id}' ready; capabilities: ${description.capabilities.join(', ') || 'none'}`,
    );
    return description;
  }

  /**
   * Asks the plugin to perform an operation.
   * @param op The operation.
   * @param params The operation's parameters.
   * @param timeoutMs How long to wait before abandoning it.
   * @returns Returns the plugin's answer, or a failure saying why there was none.
   */
  public request<Op extends HostingOp>(
    op: Op,
    params: HostingParams<Op>,
    timeoutMs: number,
  ): Promise<HostingResponse<Op>> {
    if (this.description === null) {
      return Promise.resolve({ id: 0, ok: false, error: `${this.id} is not running.` });
    }
    return this.send(op, params, timeoutMs);
  }

  /**
   * Stops the plugin and fails anything still in flight.
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
    logger.debug('HostingClient', `'${this.id}' stopped`);
    if (child.exitCode !== null || child.signalCode !== null) {
      return;
    }
    const escalation: NodeJS.Timeout = setTimeout((): void => {
      if (child.exitCode === null && child.signalCode === null) {
        logger.warn('HostingClient', `'${this.id}' ignored SIGTERM; killing it`);
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
  private send(op: HostingOp, params: unknown, timeoutMs: number): Promise<HostingResponse> {
    const id: number = this.nextId;
    this.nextId += 1;
    if (this.process?.stdin === undefined || this.process.stdin === null || this.disposed) {
      return Promise.resolve({ id, ok: false, error: `${this.id} is not running.` });
    }
    const request: HostingRequest = { id, op, params: params as HostingRequest['params'] };
    return new Promise<HostingResponse>((resolve): void => {
      const timer: NodeJS.Timeout = setTimeout((): void => {
        this.pending.delete(id);
        logger.warn('HostingClient', `'${this.id}' did not answer ${op} (${id}) in time`);
        resolve({ id, ok: false, error: `${this.id} did not answer in time.` });
      }, timeoutMs);
      timer.unref?.();
      this.pending.set(id, {
        resolve: (response: HostingResponse): void => {
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
  private write(message: HostingRequest | HostingCredentialAnswer): boolean {
    try {
      this.process?.stdin?.write(`${JSON.stringify(message)}\n`);
      return this.process !== null;
    } catch (error: unknown) {
      logger.warn('HostingClient', `Could not write to '${this.id}'`, error);
      return false;
    }
  }

  /**
   * Consumes stdout, dispatching each complete line.
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
   * Parses one line: a credential request is answered, a response is handed to whoever is waiting for
   * it, and anything else is dropped.
   * @param line The line.
   */
  private dispatch(line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      logger.debug('HostingClient', `'${this.id}' wrote a line that is not JSON`);
      return;
    }
    if (isCredentialRequest(parsed)) {
      void this.answerCredential(parsed.callId, parsed.host);
      return;
    }
    const response: HostingResponse | null = readResponse(parsed);
    if (response === null) {
      logger.debug('HostingClient', `'${this.id}' wrote a malformed message`);
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
   * Answers a credential request. The source decides whether this plugin may have the host's
   * credential at all; a failure to read it answers null rather than leaving the plugin waiting.
   * @param callId The request's correlation identifier.
   * @param host The host whose credential is wanted.
   */
  private async answerCredential(callId: number, host: string): Promise<void> {
    let token: string | null = null;
    try {
      token = await this.credentials(host);
    } catch (error: unknown) {
      logger.warn('HostingClient', `Could not read the credential '${this.id}' asked for`, error);
    }
    // Never logged: the token is a secret, and whether one was found is all a log needs.
    logger.debug(
      'HostingClient',
      `'${this.id}' asked for ${host}'s credential (${token !== null})`,
    );
    this.write({ answer: 'credential', callId, token });
  }

  /**
   * Handles the plugin exiting, failing everything still in flight.
   * @param code The exit code, or null when it was killed.
   */
  private onExit(code: number | null): void {
    if (!this.disposed) {
      logger.warn('HostingClient', `'${this.id}' exited (${code ?? 'signal'})`);
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
 * Determines whether an untrusted message is a credential request.
 * @param value The parsed line.
 * @returns Returns true when it asks for a credential, with a numeric call id and a host.
 */
function isCredentialRequest(
  value: unknown,
): value is { readonly callId: number; readonly host: string } {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record: Record<string, unknown> = value as Record<string, unknown>;
  return (
    record['request'] === 'credential' &&
    typeof record['callId'] === 'number' &&
    typeof record['host'] === 'string'
  );
}

/**
 * Narrows an untrusted line to a response: a numeric id, and either a result or an error string.
 * @param value The parsed line.
 * @returns Returns the response, or null when the line is not one.
 */
function readResponse(value: unknown): HostingResponse | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const record: Record<string, unknown> = value as Record<string, unknown>;
  if (typeof record['id'] !== 'number') {
    return null;
  }
  if (record['ok'] === true || (record['ok'] === false && typeof record['error'] === 'string')) {
    return record as unknown as HostingResponse;
  }
  return null;
}

/**
 * Narrows an untrusted initialize result to a description, dropping capabilities this build does not
 * know rather than refusing the plugin.
 * @param value The result.
 * @returns Returns the description, or null when the result is not one.
 */
function readDescription(value: unknown): HostingDescription | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const record: Record<string, unknown> = value as Record<string, unknown>;
  if (typeof record['protocol'] !== 'string' || !Array.isArray(record['capabilities'])) {
    return null;
  }
  return {
    protocol: record['protocol'],
    capabilities: record['capabilities'].filter(isHostingCapability),
  };
}
