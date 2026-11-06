import { ChildProcess, spawn } from 'node:child_process';
import {
  isCompatiblePackageManagerProtocol,
  isPackageManagerCapability,
  PACKAGE_MANAGER_PROTOCOL_VERSION,
  PackageManagerCredentialAnswer,
  PackageManagerDescription,
  PackageManagerOp,
  PackageManagerParams,
  PackageManagerRequest,
  PackageManagerResponse,
} from '@shared/api/package-manager-protocol';
import { logger } from '../logger';
import { LineSplitter, MAX_LINE_LENGTH } from '../line-splitter';
import { pluginEnvironment } from '../plugin-environment';
import { pidJournal } from '../pid-journal';
import { PackageManagerSpec } from './package-manager-descriptor';
import { PackageManagerEndpoint } from './package-manager-endpoint';

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
 * Answers a plugin's request for a registry's credential.
 */
export type PackageManagerCredentialSource = (registry: string) => Promise<string | null>;

/**
 * Holds a request awaiting its answer.
 */
interface Pending {
  readonly resolve: (response: PackageManagerResponse) => void;
  readonly timer: NodeJS.Timeout;
}

/**
 * Speaks the package-manager protocol to one plugin process (#908).
 *
 * Long-lived for the session, like a version-control plugin, so its start-up cost is paid once. Every
 * request resolves — to the plugin's answer, or to a failure saying why there was none — so a plugin
 * that dies, hangs or answers a question nobody asked costs the caller one failed operation. The
 * plugin may ask for a registry's credential mid-request; whether it may have one is decided by the
 * source this client is given, never here.
 */
export class PackageManagerClient implements PackageManagerEndpoint {
  /**
   * Holds the plugin's identifier, for logging.
   */
  private readonly id: string;

  /**
   * Holds how to spawn the plugin.
   */
  private readonly spec: PackageManagerSpec;

  /**
   * Holds where the plugin's credential requests are answered from.
   */
  private readonly credentials: PackageManagerCredentialSource;

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
  private description: PackageManagerDescription | null = null;

  /**
   * Holds whether the client has been disposed, so a late exit is not reported as a failure.
   */
  private disposed: boolean = false;

  /**
   * Initializes the client. The process is not started until {@link start} is called.
   * @param id The plugin identifier, for logging.
   * @param spec How to spawn the plugin.
   * @param credentials Where the plugin's credential requests are answered from.
   * @param maxLineLength The longest stdout line to buffer; defaults to {@link MAX_LINE_LENGTH}.
   */
  public constructor(
    id: string,
    spec: PackageManagerSpec,
    credentials: PackageManagerCredentialSource,
    maxLineLength: number = MAX_LINE_LENGTH,
  ) {
    this.id = id;
    this.spec = spec;
    this.credentials = credentials;
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
  public async start(): Promise<PackageManagerDescription | null> {
    if (this.description !== null) {
      return this.description;
    }
    try {
      this.process = spawn(this.spec.command, [...this.spec.args], {
        stdio: ['pipe', 'pipe', 'pipe'],
        // Only what a program needs to run, never the user's whole shell (audit S6). A token exported
        // in a profile is exactly what a plugin is not handed.
        env: pluginEnvironment(this.spec.env),
      });
    } catch (error: unknown) {
      logger.warn('PackageManagerClient', `Could not spawn '${this.id}'`, error);
      return null;
    }
    // Journalled like every other long-lived child, so one left behind by an abrupt exit is reaped on
    // the next launch (#583).
    pidJournal()?.register(this.process.pid, 'package-manager', this.spec.command);

    this.process.stdout?.setEncoding('utf8');
    // One per process, so what a dead one left half-written, or still has in the pipe, can never
    // be read as the start of its successor's first line.
    const lines: LineSplitter = new LineSplitter({
      trim: true,
      maxLineLength: this.maxLineLength,
      onLine: (line: string): void => this.dispatch(line),
      onOversized: (): void => this.refuseOversizedLine(),
    });
    this.process.stdout?.on('data', (chunk: string): void => lines.push(chunk));
    this.process.stderr?.setEncoding('utf8');
    this.process.stderr?.on('data', (chunk: string): void => {
      logger.debug('PackageManagerClient', `[${this.id}] ${chunk.trimEnd()}`);
    });
    this.process.on('exit', (code: number | null): void => this.onExit(code));
    this.process.on('error', (error: Error): void => {
      logger.warn('PackageManagerClient', `'${this.id}' failed`, error);
      this.onExit(null);
    });

    const response: PackageManagerResponse = await this.send(
      'initialize',
      undefined,
      { protocol: PACKAGE_MANAGER_PROTOCOL_VERSION },
      HANDSHAKE_TIMEOUT_MS,
    );
    const description: PackageManagerDescription | null = response.ok
      ? readDescription(response.result)
      : null;
    if (description === null) {
      logger.warn('PackageManagerClient', `'${this.id}' did not initialize; discarding it`);
      this.dispose();
      return null;
    }
    if (!isCompatiblePackageManagerProtocol(description.protocol)) {
      logger.warn(
        'PackageManagerClient',
        `'${this.id}' speaks protocol ${description.protocol}, which this build cannot; discarding it`,
      );
      this.dispose();
      return null;
    }
    this.description = description;
    logger.info(
      'PackageManagerClient',
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
  public async request<Op extends PackageManagerOp>(
    op: Op,
    root: string,
    params: PackageManagerParams<Op>,
    timeoutMs: number,
  ): Promise<PackageManagerResponse<Op>> {
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
    logger.debug('PackageManagerClient', `'${this.id}' stopped`);
    if (child.exitCode !== null || child.signalCode !== null) {
      return;
    }
    const escalation: NodeJS.Timeout = setTimeout((): void => {
      if (child.exitCode === null && child.signalCode === null) {
        logger.warn('PackageManagerClient', `'${this.id}' ignored SIGTERM; killing it`);
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
    op: PackageManagerOp,
    root: string | undefined,
    params: unknown,
    timeoutMs: number,
  ): Promise<PackageManagerResponse> {
    const id: number = this.nextId;
    this.nextId += 1;
    if (this.process?.stdin === undefined || this.process.stdin === null || this.disposed) {
      return Promise.resolve({ id, ok: false, error: `${this.id} is not running.` });
    }
    const request: PackageManagerRequest = {
      id,
      op,
      ...(root === undefined ? {} : { root }),
      params: params as PackageManagerRequest['params'],
    };
    return new Promise<PackageManagerResponse>((resolve): void => {
      const timer: NodeJS.Timeout = setTimeout((): void => {
        this.pending.delete(id);
        logger.warn('PackageManagerClient', `'${this.id}' did not answer ${op} (${id}) in time`);
        resolve({ id, ok: false, error: `${this.id} did not answer in time.` });
      }, timeoutMs);
      timer.unref?.();
      this.pending.set(id, {
        resolve: (response: PackageManagerResponse): void => {
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
  private write(message: PackageManagerRequest | PackageManagerCredentialAnswer): boolean {
    try {
      this.process?.stdin?.write(`${JSON.stringify(message)}\n`);
      return this.process !== null;
    } catch (error: unknown) {
      logger.warn('PackageManagerClient', `Could not write to '${this.id}'`, error);
      return false;
    }
  }

  /**
   * Refuses a stdout line that has outgrown {@link maxLineLength} without ending: the buffered part
   * is dropped and the rest skipped up to its newline, so the stream stays in step for the messages
   * after it. Which request the line answered cannot be read without parsing it whole, so every
   * request in flight is failed rather than left to wait out its timeout for an answer that is gone.
   */
  private refuseOversizedLine(): void {
    logger.error(
      'PackageManagerClient',
      `'${this.id}' wrote a message over ${this.maxLineLength} characters; it was dropped`,
    );
    this.failPending(`${this.id} sent an answer too large to read.`);
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
      logger.debug('PackageManagerClient', `'${this.id}' wrote a line that is not JSON`);
      return;
    }
    if (isCredentialRequest(parsed)) {
      void this.answerCredential(parsed.callId, parsed.registry);
      return;
    }
    const response: PackageManagerResponse | null = readResponse(parsed);
    if (response === null) {
      logger.debug('PackageManagerClient', `'${this.id}' wrote a malformed message`);
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
   * Answers a credential request. The source decides whether this plugin may have the registry's
   * credential at all; a failure to read it answers null rather than leaving the plugin waiting.
   * @param callId The request's correlation identifier.
   * @param registry The registry whose credential is wanted.
   */
  private async answerCredential(callId: number, registry: string): Promise<void> {
    let token: string | null = null;
    try {
      token = await this.credentials(registry);
    } catch (error: unknown) {
      logger.warn(
        'PackageManagerClient',
        `Could not read the credential '${this.id}' asked for`,
        error,
      );
    }
    // Never logged: the token is a secret, and whether one was found is all a log needs.
    logger.debug(
      'PackageManagerClient',
      `'${this.id}' asked for a registry credential (${token !== null})`,
    );
    this.write({ answer: 'credential', callId, token });
  }

  /**
   * Handles the plugin exiting, failing everything still in flight.
   * @param code The exit code, or null when it was killed.
   */
  private onExit(code: number | null): void {
    if (!this.disposed) {
      logger.warn('PackageManagerClient', `'${this.id}' exited (${code ?? 'signal'})`);
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
 * @returns Returns true when it asks for a credential, with a numeric call id and a registry.
 */
function isCredentialRequest(
  value: unknown,
): value is { readonly callId: number; readonly registry: string } {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record: Record<string, unknown> = value as Record<string, unknown>;
  return (
    record['request'] === 'credential' &&
    typeof record['callId'] === 'number' &&
    typeof record['registry'] === 'string'
  );
}

/**
 * Narrows an untrusted line to a response: a numeric id, and either a result or an error string.
 * @param value The parsed line.
 * @returns Returns the response, or null when the line is not one.
 */
function readResponse(value: unknown): PackageManagerResponse | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const record: Record<string, unknown> = value as Record<string, unknown>;
  if (typeof record['id'] !== 'number') {
    return null;
  }
  if (record['ok'] === true || (record['ok'] === false && typeof record['error'] === 'string')) {
    return record as unknown as PackageManagerResponse;
  }
  return null;
}

/**
 * Narrows an untrusted initialize result to a description, dropping capabilities this build does not
 * know rather than refusing the plugin: an unknown capability is one Studio would never offer anyway.
 * @param value The result.
 * @returns Returns the description, or null when the result is not one.
 */
function readDescription(value: unknown): PackageManagerDescription | null {
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
    capabilities: record['capabilities'].filter(isPackageManagerCapability),
    toolVersion: typeof toolVersion === 'string' ? toolVersion : null,
    ...(typeof problem === 'string' ? { problem } : {}),
  };
}
