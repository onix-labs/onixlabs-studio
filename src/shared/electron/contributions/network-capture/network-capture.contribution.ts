import { ChildProcess, spawn } from 'node:child_process';
import { createReadStream, createWriteStream, ReadStream, WriteStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import {
  CapturedPacket,
  CaptureFileRequest,
  CaptureRequest,
  CaptureSaveRequest,
  CaptureStart,
  MAX_CAPTURE_PACKETS,
  NetworkCaptureChannel,
} from '@shared/api/network-capture-channels';
import { ContributionContext, MainContribution } from '../main-contribution';
import {
  CaptureCommand,
  captureCommand,
  isPermissionError,
  isValidFilter,
  isValidInterface,
} from './capture-command';
import { CaptureSession } from './capture-session';

/**
 * Starts tcpdump. A seam, so the contribution can be tested without capturing anything.
 */
export type CaptureSpawner = (command: string, args: readonly string[]) => ChildProcess;

/**
 * How often the packets captured are sent to the renderer, in milliseconds: often enough to look
 * live, seldom enough that a busy interface sends a few batches a second rather than a message a
 * packet.
 */
const BATCH_INTERVAL_MS: number = 200;

/**
 * The most packets sent in one batch, so a capture file of a million packets reaches the renderer in
 * pieces it can take.
 */
const MAX_BATCH: number = 5000;

/**
 * One capture the contribution is running or holding.
 */
interface CaptureEntry {
  /**
   * Gets the capture's packets.
   */
  readonly session: CaptureSession;

  /**
   * Gets tcpdump, while a live capture runs.
   */
  process?: ChildProcess;

  /**
   * Gets the stream a live capture is written to, while it runs.
   */
  output?: WriteStream;

  /**
   * Gets the stream a capture file is read from, while it is read.
   */
  input?: ReadStream;

  /**
   * Gets whether the file is the contribution's own, to be deleted with the capture.
   */
  readonly temporary: boolean;

  /**
   * Gets whether the user asked for the capture to stop.
   */
  stopping: boolean;

  /**
   * Gets why the capture ended, when it was not asked to.
   */
  problem?: string;
}

/**
 * Starts tcpdump with nothing read from its standard input.
 * @param command The executable.
 * @param args Its arguments.
 * @returns Returns the process.
 */
function spawnCapture(command: string, args: readonly string[]): ChildProcess {
  return spawn(command, [...args], { stdio: ['ignore', 'pipe', 'pipe'] });
}

/**
 * Reads an object's string property.
 * @param value The object, as sent.
 * @param key The property.
 * @returns Returns the string, or undefined when it is not one.
 */
function stringOf(value: unknown, key: string): string | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const property: unknown = (value as Record<string, unknown>)[key];
  return typeof property === 'string' ? property : undefined;
}

/**
 * Reads a capture's id out of what was sent.
 * @param value The id, as sent.
 * @returns Returns the id, or undefined when it is not one.
 */
function idOf(value: unknown): string | undefined {
  return typeof value === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(value) ? value : undefined;
}

/**
 * Captures packets for the Network Explorer: live from an interface through the operating system's
 * `tcpdump`, or from a capture file. Each packet is summarised as it is read and the summaries are
 * sent to the renderer in batches; a packet's bytes are sent only when the renderer asks for that
 * packet, so a long capture never crosses the bridge whole.
 *
 * A live capture is written to a temporary file as it arrives, which is what saving copies and what
 * older packets are read back from. The file goes when the capture is released.
 */
export class NetworkCaptureContribution implements MainContribution {
  /**
   * The stable contribution id.
   */
  public readonly id: string = 'network-capture';

  /**
   * Holds the captures, by id.
   */
  private readonly captures: Map<string, CaptureEntry> = new Map<string, CaptureEntry>();

  /**
   * Holds the timer that sends batches, while any capture has packets to send.
   */
  private timer: ReturnType<typeof setInterval> | undefined;

  /**
   * Holds the contribution context, once activated.
   */
  private context: ContributionContext | undefined;

  /**
   * Creates the contribution.
   * @param spawner Starts tcpdump.
   * @param platform The operating system.
   * @param directory Where live captures are written while they run.
   */
  public constructor(
    private readonly spawner: CaptureSpawner = spawnCapture,
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly directory: string = join(tmpdir(), 'onixlabs-studio-captures'),
  ) {}

  /**
   * Wires the capture channels.
   * @param context The surface the contribution reaches the application through.
   */
  public activate(context: ContributionContext): void {
    this.context = context;
    context.handle(
      NetworkCaptureChannel.Start,
      (_event: unknown, payload: unknown): Promise<CaptureStart> => this.start(payload),
    );
    context.handle(
      NetworkCaptureChannel.Open,
      (_event: unknown, payload: unknown): Promise<CaptureStart> => this.openFile(payload),
    );
    context.handle(
      NetworkCaptureChannel.Packet,
      async (_event: unknown, payload: unknown): Promise<CapturedPacket | null> => {
        const id: string | undefined = idOf(stringOf(payload, 'id'));
        const number: unknown =
          typeof payload === 'object' && payload !== null
            ? (payload as Record<string, unknown>)['number']
            : undefined;
        const entry: CaptureEntry | undefined =
          id === undefined ? undefined : this.captures.get(id);
        if (entry === undefined || typeof number !== 'number' || !Number.isInteger(number)) {
          return null;
        }
        return (await entry.session.packet(number)) ?? null;
      },
    );
    context.handle(
      NetworkCaptureChannel.Save,
      (_event: unknown, payload: unknown): Promise<boolean> => this.save(payload),
    );
    context.on(NetworkCaptureChannel.Stop, (_event: unknown, payload: unknown): void => {
      const id: string | undefined = idOf(payload);
      if (id !== undefined) {
        this.stop(id);
      }
    });
    context.on(NetworkCaptureChannel.Release, (_event: unknown, payload: unknown): void => {
      const id: string | undefined = idOf(payload);
      if (id !== undefined) {
        void this.release(id);
      }
    });
  }

  /**
   * Stops every capture and deletes their temporary files.
   */
  public async dispose(): Promise<void> {
    await Promise.all(
      [...this.captures.keys()].map((id: string): Promise<void> => this.release(id)),
    );
    clearInterval(this.timer);
    this.timer = undefined;
  }

  /**
   * Starts a live capture.
   * @param payload The request, as sent.
   * @returns Returns a promise resolving whether it started.
   */
  private async start(payload: unknown): Promise<CaptureStart> {
    const request: CaptureRequest | undefined = this.readRequest(payload);
    if (request === undefined) {
      return {
        kind: 'failed',
        message: 'That is not an interface and filter that can be captured.',
        permission: false,
      };
    }
    const command: CaptureCommand | undefined = captureCommand(
      request.interfaceId,
      request.filter,
      this.platform,
    );
    if (command === undefined) {
      return {
        kind: 'failed',
        message: 'Capturing is not supported on this platform yet.',
        permission: false,
      };
    }
    if (this.captures.has(request.id)) {
      return { kind: 'failed', message: 'That capture is already running.', permission: false };
    }
    await mkdir(this.directory, { recursive: true });
    const file: string = join(this.directory, `${request.id}.pcap`);
    const entry: CaptureEntry = {
      session: new CaptureSession(request.id, file),
      temporary: true,
      stopping: false,
    };
    this.captures.set(request.id, entry);
    const child: ChildProcess = this.spawner(command.command, command.args);
    const output: WriteStream = createWriteStream(file);
    entry.process = child;
    entry.output = output;
    this.context?.log.info('Capture started', {
      interface: request.interfaceId,
      filter: request.filter,
    });
    return new Promise<CaptureStart>((resolve: (start: CaptureStart) => void): void => {
      let settled: boolean = false;
      let errors: string = '';
      const settle: (start: CaptureStart) => void = (start: CaptureStart): void => {
        if (!settled) {
          settled = true;
          resolve(start);
        }
      };
      child.stderr?.on('data', (chunk: Buffer): void => {
        errors += chunk.toString('utf8');
        // tcpdump says it is listening before it has a packet to write; that is the capture starting.
        if (/listening on/i.test(errors)) {
          settle({ kind: 'started' });
        }
      });
      child.stdout?.on('data', (chunk: Buffer): void => {
        settle({ kind: 'started' });
        output.write(chunk);
        this.read(entry, chunk);
      });
      child.once('error', (error: Error): void => {
        settle({
          kind: 'failed',
          message: `Could not start tcpdump: ${error.message}`,
          permission: false,
        });
      });
      child.once('close', (code: number | null): void => {
        output.end();
        entry.process = undefined;
        entry.output = undefined;
        const complaint: string =
          errors
            .split('\n')
            .map((line: string): string => line.trim())
            .filter(
              (line: string): boolean =>
                line.length > 0 && !/listening on|packets? (captured|received|dropped)/i.test(line),
            )
            .at(-1) ?? '';
        if (!settled) {
          settle({
            kind: 'failed',
            message: complaint || `tcpdump exited with code ${String(code)}.`,
            permission: isPermissionError(errors),
          });
          void this.release(request.id);
          return;
        }
        if (!entry.stopping && entry.problem === undefined && code !== 0) {
          entry.problem = complaint || `tcpdump exited with code ${String(code)}.`;
        }
        this.end(entry);
      });
    });
  }

  /**
   * Reads a capture file.
   * @param payload The request, as sent.
   * @returns Returns a promise resolving whether it could be read.
   */
  private async openFile(payload: unknown): Promise<CaptureStart> {
    const id: string | undefined = idOf(stringOf(payload, 'id'));
    const path: string | undefined = stringOf(payload, 'path');
    if (id === undefined || path === undefined || !isAbsolute(path) || this.captures.has(id)) {
      return {
        kind: 'failed',
        message: 'That is not a capture file that can be opened.',
        permission: false,
      };
    }
    const request: CaptureFileRequest = { id, path };
    const entry: CaptureEntry = {
      session: new CaptureSession(request.id, request.path),
      temporary: false,
      stopping: false,
    };
    this.captures.set(request.id, entry);
    const input: ReadStream = createReadStream(request.path);
    entry.input = input;
    return new Promise<CaptureStart>((resolve: (start: CaptureStart) => void): void => {
      let settled: boolean = false;
      input.on('data', (chunk: Buffer | string): void => {
        if (typeof chunk === 'string') {
          return;
        }
        this.read(entry, chunk);
        if (!settled && entry.problem !== undefined) {
          settled = true;
          resolve({ kind: 'failed', message: entry.problem, permission: false });
          void this.release(request.id);
          return;
        }
        if (!settled && entry.session.linkType !== undefined) {
          settled = true;
          resolve({ kind: 'started' });
        }
      });
      input.once('error', (error: Error): void => {
        entry.problem = error.message;
        if (!settled) {
          settled = true;
          resolve({ kind: 'failed', message: error.message, permission: false });
          void this.release(request.id);
        }
      });
      input.once('close', (): void => {
        entry.input = undefined;
        if (!settled) {
          settled = true;
          resolve({
            kind: 'failed',
            message: entry.problem ?? 'The file is empty.',
            permission: false,
          });
          void this.release(request.id);
          return;
        }
        this.end(entry);
      });
    });
  }

  /**
   * Reads a chunk of a capture's stream, and stops the capture if it is not pcap or has reached the
   * most packets a capture keeps.
   * @param entry The capture.
   * @param chunk The chunk.
   */
  private read(entry: CaptureEntry, chunk: Uint8Array): void {
    if (entry.problem !== undefined) {
      return;
    }
    try {
      entry.session.accept(chunk);
    } catch (error: unknown) {
      entry.problem = error instanceof Error ? error.message : String(error);
      this.halt(entry);
      return;
    }
    if (entry.session.count >= MAX_CAPTURE_PACKETS) {
      entry.problem = `The capture stopped at ${MAX_CAPTURE_PACKETS.toLocaleString('en')} packets.`;
      this.halt(entry);
    }
    this.timer ??= setInterval((): void => this.flush(), BATCH_INTERVAL_MS);
  }

  /**
   * Stops reading a capture: interrupts tcpdump, the way Ctrl-C does, so it ends its file whole, or
   * stops reading the file.
   * @param entry The capture.
   */
  private halt(entry: CaptureEntry): void {
    entry.process?.kill('SIGINT');
    entry.input?.destroy();
  }

  /**
   * Stops a capture the user asked to stop.
   * @param id The capture's id.
   */
  private stop(id: string): void {
    const entry: CaptureEntry | undefined = this.captures.get(id);
    if (entry !== undefined) {
      entry.stopping = true;
      this.halt(entry);
    }
  }

  /**
   * Sends a capture's last packets and says it has ended.
   * @param entry The capture.
   */
  private end(entry: CaptureEntry): void {
    this.flush();
    this.context?.send(NetworkCaptureChannel.Ended, {
      id: entry.session.id,
      ...(entry.problem === undefined ? {} : { message: entry.problem }),
    });
    this.context?.log.info('Capture ended', {
      packets: entry.session.count,
      problem: entry.problem,
    });
  }

  /**
   * Sends every capture's packets read since the last batch, a bounded batch each.
   */
  private flush(): void {
    let waiting: boolean = false;
    for (const entry of this.captures.values()) {
      const rows: ReturnType<CaptureSession['takePending']> = entry.session.takePending();
      for (let start: number = 0; start < rows.length; start += MAX_BATCH) {
        this.context?.send(NetworkCaptureChannel.Packets, {
          id: entry.session.id,
          packets: rows.slice(start, start + MAX_BATCH),
        });
      }
      waiting ||= entry.process !== undefined || entry.input !== undefined;
    }
    if (!waiting) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /**
   * Writes a capture to a file.
   * @param payload The request, as sent.
   * @returns Returns a promise resolving true once written.
   */
  private async save(payload: unknown): Promise<boolean> {
    const id: string | undefined = idOf(stringOf(payload, 'id'));
    const path: string | undefined = stringOf(payload, 'path');
    const entry: CaptureEntry | undefined = id === undefined ? undefined : this.captures.get(id);
    if (entry === undefined || path === undefined || !isAbsolute(path)) {
      return false;
    }
    const request: CaptureSaveRequest = { id: entry.session.id, path };
    const output: WriteStream | undefined = entry.output;
    if (output !== undefined) {
      // Writes complete in order, so once an empty one has, everything read so far is on disk.
      await new Promise<void>(
        (resolve: () => void): void => void output.write('', (): void => resolve()),
      );
    }
    try {
      await entry.session.save(request.path);
      return true;
    } catch (error: unknown) {
      this.context?.log.warn('Could not save the capture', error);
      return false;
    }
  }

  /**
   * Forgets a capture: stops it, and deletes its file when the file is the contribution's own.
   * @param id The capture's id.
   */
  private async release(id: string): Promise<void> {
    const entry: CaptureEntry | undefined = this.captures.get(id);
    if (entry === undefined) {
      return;
    }
    this.captures.delete(id);
    entry.stopping = true;
    this.halt(entry);
    if (entry.temporary) {
      await rm(entry.session.file, { force: true });
    }
  }

  /**
   * Reads a live capture request out of what was sent.
   * @param payload The request, as sent.
   * @returns Returns the request, or undefined when it is not a valid one.
   */
  private readRequest(payload: unknown): CaptureRequest | undefined {
    const id: string | undefined = idOf(stringOf(payload, 'id'));
    const interfaceId: string | undefined = stringOf(payload, 'interfaceId');
    const filter: string = stringOf(payload, 'filter') ?? '';
    return id === undefined ||
      interfaceId === undefined ||
      !isValidInterface(interfaceId) ||
      !isValidFilter(filter)
      ? undefined
      : { id, interfaceId, filter };
  }
}

/**
 * The singleton network-capture contribution appended to the `mainContributions` manifest.
 */
export const networkCaptureContribution: MainContribution = new NetworkCaptureContribution();
