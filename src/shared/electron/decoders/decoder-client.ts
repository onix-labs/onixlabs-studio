import { ChildProcess, spawn } from 'node:child_process';
import { CodeListing } from '@shared/api/code-listing';
import {
  DecoderDescription,
  DecoderRequest,
  DecoderResponse,
  isCompatibleProtocol,
} from '@shared/api/decoder-protocol';
import { logger } from '../logger';
import { LineSplitter, MAX_LINE_LENGTH } from '../line-splitter';
import { pluginEnvironment } from '../plugin-environment';
import { pidJournal } from '../pid-journal';
import { DecoderSpec } from './decoder-descriptor';

/**
 * Specifies how long a single request may take before it is abandoned.
 *
 * A decoder is a third-party process. One that hangs must cost the caller a missing listing rather
 * than a wedged panel, so every request is bounded and a timed-out request resolves to nothing rather
 * than never resolving at all.
 */
const REQUEST_TIMEOUT_MS: number = 10_000;

/**
 * Specifies how long the describe handshake may take. Shorter than a decode: a decoder that cannot say
 * what it is promptly is not one worth waiting on, and this runs before anything is on screen.
 */
const HANDSHAKE_TIMEOUT_MS: number = 5_000;

/**
 * Specifies the grace period, in milliseconds, between SIGTERM and SIGKILL when stopping a decoder.
 * Long enough for a healthy decoder to close its stdio and exit, short enough that a wedged one does
 * not linger.
 */
const KILL_GRACE_MS: number = 2_000;

/**
 * Holds a request awaiting its answer.
 */
interface Pending {
  readonly resolve: (response: DecoderResponse) => void;
  readonly timer: NodeJS.Timeout;
}

/**
 * Speaks the decoder protocol to one decoder process.
 *
 * The process is long-lived for the session rather than spawned per request, so a runtime's start-up
 * cost is paid once — which is the whole reason the protocol is a conversation rather than a command.
 *
 * Everything here is defensive, because a decoder is code the user installed and Studio did not write:
 * a decoder that dies, hangs, floods stdout, or answers a question nobody asked must cost a listing and
 * nothing more.
 */
export class DecoderClient {
  /**
   * Holds the decoder's identifier, for logging.
   */
  private readonly id: string;

  /**
   * Holds how to spawn the decoder.
   */
  private readonly spec: DecoderSpec;

  /**
   * Holds the running process, or null before it starts and after it exits.
   */
  private process: ChildProcess | null = null;

  /**
   * Holds the requests awaiting answers, keyed by correlation identifier.
   */
  private readonly pending: Map<number, Pending> = new Map<number, Pending>();

  /**
   * Holds the longest stdout line the client will buffer before refusing it.
   */
  private readonly maxLineLength: number;

  /**
   * Holds the next correlation identifier.
   */
  private nextId: number = 1;

  /**
   * Holds what the decoder said it was, or null before the handshake completes.
   */
  private description: DecoderDescription | null = null;

  /**
   * Holds whether the client has been disposed, so a late exit does not restart anything.
   */
  private disposed: boolean = false;

  /**
   * Initializes the client. The process is not started until {@link start} is called.
   * @param id The decoder identifier, for logging.
   * @param spec How to spawn the decoder.
   * @param maxLineLength The longest stdout line to buffer; defaults to {@link MAX_LINE_LENGTH}.
   */
  public constructor(id: string, spec: DecoderSpec, maxLineLength: number = MAX_LINE_LENGTH) {
    this.id = id;
    this.spec = spec;
    this.maxLineLength = maxLineLength;
  }

  /**
   * Starts the decoder and completes the describe handshake.
   *
   * A decoder announcing an incompatible protocol is refused rather than spoken to: one that
   * misunderstands a byte range returns a listing that is wrong rather than absent, and wrong is the
   * worse failure — it looks like a correct answer.
   * @returns Returns what the decoder said it is, or null when it could not be started or was refused.
   */
  public async start(): Promise<DecoderDescription | null> {
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
      logger.warn('DecoderClient', `Could not spawn decoder '${this.id}'`, error);
      return null;
    }
    // Journal the child like every other long-lived process Studio owns (terminals, language servers,
    // debug adapters, agent runs). Ordinary shutdown stops it below; the journal is what reaps it after
    // a shutdown that never ran — a SIGKILL, a power loss — on the next launch, rather than leaving a
    // decoder running for an application that no longer exists (#583).
    pidJournal()?.register(this.process.pid, 'decoder', this.spec.command);

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
      logger.debug('DecoderClient', `[${this.id}] ${chunk.trimEnd()}`);
    });
    this.process.on('exit', (code: number | null): void => this.onExit(code));
    this.process.on('error', (error: Error): void => {
      logger.warn('DecoderClient', `Decoder '${this.id}' failed`, error);
      this.onExit(null);
    });

    const response: DecoderResponse | null = await this.send(
      { id: this.nextId, op: 'describe' },
      HANDSHAKE_TIMEOUT_MS,
    );
    if (response === null || !response.ok || response.description === undefined) {
      logger.warn('DecoderClient', `Decoder '${this.id}' did not describe itself; discarding it`);
      this.dispose();
      return null;
    }
    if (!isCompatibleProtocol(response.description.protocol)) {
      logger.warn(
        'DecoderClient',
        `Decoder '${this.id}' speaks protocol ${response.description.protocol}, which this build cannot; discarding it`,
      );
      this.dispose();
      return null;
    }
    this.description = response.description;
    logger.info(
      'DecoderClient',
      `Decoder '${this.id}' ready for ${this.description.formats.join(', ')}`,
    );
    return this.description;
  }

  /**
   * Gets what the decoder said it is, or null before a successful handshake.
   * @returns Returns the description, or null.
   */
  public describe(): DecoderDescription | null {
    return this.description;
  }

  /**
   * Asks the decoder to decode a window of bytes.
   * @param format The format key the caller resolved this decoder for.
   * @param bytes The bytes to decode.
   * @param baseOffset The absolute file offset of the first byte.
   * @param totalSize The whole file's size, when the bytes are a window of it.
   * @param path The file the bytes came from, for display only.
   * @param companions Companion files the decoder may need, keyed by name.
   * @returns Returns the listing, or null when the decoder failed, timed out, or is not running.
   */
  public async decode(
    format: string,
    bytes: Uint8Array,
    baseOffset: number,
    totalSize?: number,
    path?: string,
    companions?: Readonly<Record<string, Uint8Array>>,
  ): Promise<CodeListing | null> {
    if (this.description === null) {
      return null;
    }
    const response: DecoderResponse | null = await this.send(
      {
        id: this.nextId,
        op: 'decode',
        format,
        bytes: Buffer.from(bytes).toString('base64'),
        baseOffset,
        totalSize,
        path,
        companions: encodeCompanions(companions),
      },
      REQUEST_TIMEOUT_MS,
    );
    if (response === null) {
      return null;
    }
    if (!response.ok) {
      logger.debug('DecoderClient', `Decoder '${this.id}' refused a decode: ${response.error}`);
      return null;
    }
    return response.listing ?? null;
  }

  /**
   * Stops the decoder and abandons anything still in flight.
   *
   * SIGTERM asks; it does not compel. A decoder wedged in a native call, or one that installed its own
   * handler, ignores it and would go on running — so the term is followed by a SIGKILL once a grace
   * period passes without the process exiting. The escalation timer is unreferenced so it can never
   * hold the event loop open at quit; that case is covered instead by the pid journal, which reaps on
   * the next launch what an abrupt exit left behind (#583).
   */
  public dispose(): void {
    this.disposed = true;
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
    }
    this.pending.clear();
    this.description = null;
    const child: ChildProcess | null = this.process;
    if (child === null) {
      return;
    }
    this.process = null;
    pidJournal()?.unregister(child.pid);
    child.stdin?.end();
    child.kill();
    logger.debug('DecoderClient', `Decoder '${this.id}' stopped`);
    if (child.exitCode !== null || child.signalCode !== null) {
      return;
    }
    const escalation: NodeJS.Timeout = setTimeout((): void => {
      if (child.exitCode === null && child.signalCode === null) {
        logger.warn('DecoderClient', `Decoder '${this.id}' ignored SIGTERM; killing it`);
        child.kill('SIGKILL');
      }
    }, KILL_GRACE_MS);
    escalation.unref?.();
    child.once('exit', (): void => clearTimeout(escalation));
  }

  /**
   * Sends a request and waits for its answer.
   * @param request The request to send.
   * @param timeoutMs How long to wait before abandoning it.
   * @returns Returns the response, or null when the decoder is not running or did not answer in time.
   */
  private send(request: DecoderRequest, timeoutMs: number): Promise<DecoderResponse | null> {
    const stdin: NodeJS.WritableStream | null = this.process?.stdin ?? null;
    if (stdin === null || this.disposed) {
      return Promise.resolve(null);
    }
    const id: number = request.id;
    this.nextId += 1;
    return new Promise<DecoderResponse | null>((resolve): void => {
      const timer: NodeJS.Timeout = setTimeout((): void => {
        this.pending.delete(id);
        logger.warn('DecoderClient', `Decoder '${this.id}' did not answer request ${id} in time`);
        resolve(null);
      }, timeoutMs);
      // `unref` so a pending decode cannot hold the process open at quit.
      timer.unref?.();
      this.pending.set(id, {
        resolve: (response: DecoderResponse): void => {
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
        logger.warn('DecoderClient', `Could not write to decoder '${this.id}'`, error);
        resolve(null);
      }
    });
  }

  /**
   * Refuses a stdout line that has outgrown {@link maxLineLength} without ending. Which request the
   * line answered cannot be read without parsing it whole, so every request in flight is failed
   * rather than left to wait out its timeout for an answer that is gone.
   */
  private refuseOversizedLine(): void {
    logger.error(
      'DecoderClient',
      `Decoder '${this.id}' wrote a message over ${this.maxLineLength} characters; it was dropped`,
    );
    this.failPending('the decoder sent an answer too large to read');
  }

  /**
   * Parses one response line and hands it to whoever is waiting for it.
   * @param line The response line.
   */
  private dispatch(line: string): void {
    let response: DecoderResponse;
    try {
      response = JSON.parse(line) as DecoderResponse;
    } catch {
      logger.debug('DecoderClient', `Decoder '${this.id}' wrote a line that is not JSON`);
      return;
    }
    const entry: Pending | undefined = this.pending.get(response.id);
    if (entry === undefined) {
      // An answer to a request that already timed out, or one nobody asked. Dropped rather than
      // trusted: correlating by anything looser would let a slow answer resolve a later question.
      return;
    }
    this.pending.delete(response.id);
    entry.resolve(response);
  }

  /**
   * Handles the decoder exiting, failing everything still in flight.
   * @param code The exit code, or null when it was killed.
   */
  private onExit(code: number | null): void {
    if (!this.disposed) {
      logger.warn('DecoderClient', `Decoder '${this.id}' exited (${code ?? 'signal'})`);
    }
    this.process = null;
    this.description = null;
    this.failPending('the decoder exited');
  }

  /**
   * Fails every request still in flight.
   * @param error Why.
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
 * Encodes companion files for the wire, or returns undefined when there are none.
 * @param companions The companion files, keyed by name.
 * @returns Returns the base64-encoded companions, or undefined.
 */
function encodeCompanions(
  companions: Readonly<Record<string, Uint8Array>> | undefined,
): Readonly<Record<string, string>> | undefined {
  if (companions === undefined) {
    return undefined;
  }
  const encoded: Record<string, string> = {};
  for (const [name, bytes] of Object.entries(companions)) {
    encoded[name] = Buffer.from(bytes).toString('base64');
  }
  return Object.keys(encoded).length === 0 ? undefined : encoded;
}
