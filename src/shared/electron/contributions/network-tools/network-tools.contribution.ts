import { ChildProcess, spawn } from 'node:child_process';
import { createInterface, Interface } from 'node:readline';
import {
  MAX_PING_COUNT,
  MAX_TRACE_HOPS,
  NetworkToolsChannel,
  PingOutcome,
  PingReply,
  PingRequest,
  TraceHop,
  TraceOutcome,
  TraceRequest,
} from '@shared/api/network-tools-channels';
import { ContributionContext, MainContribution } from '../main-contribution';
import {
  isValidHost,
  NetworkToolCommand,
  pingCommand,
  traceCommand,
} from './network-tool-commands';
import {
  parsePingAddress,
  parsePingLine,
  parsePingTransmitted,
  parseTraceAddress,
  TraceOutputReader,
} from './network-tool-output';

/**
 * Starts a tool's process. A seam, so the contribution can be tested without running anything.
 */
export type ToolSpawner = (command: string, args: readonly string[]) => ChildProcess;

/**
 * Describes how a tool's process ended.
 */
interface ToolExit {
  /**
   * Gets the exit code, or null when the process was killed or never started.
   */
  readonly code: number | null;

  /**
   * Gets the last line the tool wrote to its error stream that was not its header, which is where
   * it says what went wrong.
   */
  readonly lastError: string | undefined;

  /**
   * Gets whether the run was stopped by a cancel.
   */
  readonly cancelled: boolean;

  /**
   * Gets why the process could not be started, when it could not.
   */
  readonly startError: string | undefined;
}

/**
 * The most runs that may be going at once, so a renderer cannot fill the machine with pings.
 */
const MAX_RUNNING: number = 16;

/**
 * Starts a tool with no shell and nothing read from its standard input.
 * @param command The executable.
 * @param args Its arguments.
 * @returns Returns the process.
 */
function spawnTool(command: string, args: readonly string[]): ChildProcess {
  return spawn(command, [...args], { stdio: ['ignore', 'pipe', 'pipe'] });
}

/**
 * Waits for a line reader to close, which it does once its stream ends.
 * @param reader The reader.
 * @returns Returns a promise resolving once it has closed.
 */
function closedOf(reader: Interface): Promise<void> {
  return new Promise<void>((resolve: () => void): void => {
    reader.once('close', (): void => resolve());
  });
}

/**
 * Reads a run's id out of what the renderer sent.
 * @param value What was sent.
 * @returns Returns the id, or undefined when it is not one.
 */
function readId(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= 64 ? value : undefined;
}

/**
 * Reads a whole number in a range out of what the renderer sent.
 * @param value What was sent.
 * @param max The largest allowed.
 * @returns Returns the number, or undefined when it is not one in range.
 */
function readCount(value: unknown, max: number): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= max
    ? value
    : undefined;
}

/**
 * Reads a ping request out of what the renderer sent.
 * @param value What was sent.
 * @returns Returns the request, or undefined when it is not a valid one.
 */
export function readPingRequest(value: unknown): PingRequest | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const record: Record<string, unknown> = value as Record<string, unknown>;
  const id: string | undefined = readId(record['id']);
  const host: unknown = record['host'];
  const count: number | undefined = readCount(record['count'], MAX_PING_COUNT);
  return id === undefined || typeof host !== 'string' || !isValidHost(host) || count === undefined
    ? undefined
    : { id, host, count };
}

/**
 * Reads a trace request out of what the renderer sent.
 * @param value What was sent.
 * @returns Returns the request, or undefined when it is not a valid one.
 */
export function readTraceRequest(value: unknown): TraceRequest | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const record: Record<string, unknown> = value as Record<string, unknown>;
  const id: string | undefined = readId(record['id']);
  const host: unknown = record['host'];
  const maxHops: number | undefined = readCount(record['maxHops'], MAX_TRACE_HOPS);
  return id === undefined || typeof host !== 'string' || !isValidHost(host) || maxHops === undefined
    ? undefined
    : { id, host, maxHops };
}

/**
 * Runs the network tools the Network Explorer offers against a host — ping and traceroute — and
 * streams what they find back to the renderer a reply or a hop at a time.
 *
 * Both are the operating system's own tools rather than reimplementations: they already hold the
 * privilege raw and ICMP sockets need (traceroute is set-uid on macOS), which neither Studio nor its
 * renderer has. Their output is parsed here, so the renderer sees replies and hops, not text.
 *
 * The host arrives from the renderer and goes on a command line, so it is validated first — an
 * address or a host name, never anything starting with `-` — and the tools are spawned without a
 * shell.
 */
export class NetworkToolsContribution implements MainContribution {
  /**
   * The stable contribution id.
   */
  public readonly id: string = 'network-tools';

  /**
   * Holds the running processes, by run id.
   */
  private readonly running: Map<string, ChildProcess> = new Map<string, ChildProcess>();

  /**
   * Holds the ids of the runs that were stopped by a cancel.
   */
  private readonly cancelled: Set<string> = new Set<string>();

  /**
   * Creates the contribution.
   * @param spawner Starts a tool's process.
   * @param platform The operating system, which decides the tools and their arguments.
   */
  public constructor(
    private readonly spawner: ToolSpawner = spawnTool,
    private readonly platform: NodeJS.Platform = process.platform,
  ) {}

  /**
   * Wires the ping, trace and cancel channels.
   * @param context The surface the contribution reaches the application through.
   */
  public activate(context: ContributionContext): void {
    context.handle(
      NetworkToolsChannel.Ping,
      (_event: unknown, payload: unknown): Promise<PingOutcome> => this.ping(payload, context),
    );
    context.handle(
      NetworkToolsChannel.Trace,
      (_event: unknown, payload: unknown): Promise<TraceOutcome> => this.trace(payload, context),
    );
    context.on(NetworkToolsChannel.Cancel, (_event: unknown, payload: unknown): void => {
      const id: string | undefined = readId(payload);
      if (id !== undefined) {
        this.cancel(id);
      }
    });
  }

  /**
   * Stops every run still going.
   */
  public dispose(): void {
    for (const id of [...this.running.keys()]) {
      this.cancel(id);
    }
  }

  /**
   * Pings a host, streaming each reply.
   * @param payload The request, as sent.
   * @param context The contribution context, to stream through.
   * @returns Returns a promise resolving how the run ended.
   */
  private async ping(payload: unknown, context: ContributionContext): Promise<PingOutcome> {
    const request: PingRequest | undefined = readPingRequest(payload);
    if (request === undefined) {
      return { kind: 'failed', message: 'That is not an address or host name that can be pinged.' };
    }
    const command: NetworkToolCommand | undefined = pingCommand(
      request.host,
      request.count,
      this.platform,
    );
    if (command === undefined) {
      return { kind: 'failed', message: 'Ping is not supported on this platform yet.' };
    }
    let address: string | undefined;
    let transmitted: number | undefined;
    let replies: number = 0;
    const exit: ToolExit = await this.run(request.id, command, (line: string): void => {
      address ??= parsePingAddress(line);
      transmitted ??= parsePingTransmitted(line);
      const reply: PingReply | undefined = parsePingLine(line);
      if (reply !== undefined) {
        replies += 1;
        context.send(NetworkToolsChannel.PingReply, { id: request.id, reply });
      }
    });
    const resolved: { readonly address?: string; readonly transmitted?: number } = {
      ...(address === undefined ? {} : { address }),
      ...(transmitted === undefined ? {} : { transmitted }),
    };
    if (exit.cancelled) {
      return { kind: 'cancelled', ...resolved };
    }
    // `ping` exits non-zero when nothing answered; that is still a ping that ran to its end.
    if (exit.code === 0 || replies > 0) {
      return { kind: 'completed', ...resolved };
    }
    return {
      kind: 'failed',
      ...resolved,
      message: exit.startError ?? exit.lastError ?? `Ping exited with code ${String(exit.code)}.`,
    };
  }

  /**
   * Traces the route to a host, streaming each hop as it is learned.
   * @param payload The request, as sent.
   * @param context The contribution context, to stream through.
   * @returns Returns a promise resolving how the run ended.
   */
  private async trace(payload: unknown, context: ContributionContext): Promise<TraceOutcome> {
    const request: TraceRequest | undefined = readTraceRequest(payload);
    if (request === undefined) {
      return { kind: 'failed', message: 'That is not an address or host name that can be traced.' };
    }
    const command: NetworkToolCommand | undefined = traceCommand(
      request.host,
      request.maxHops,
      this.platform,
    );
    if (command === undefined) {
      return { kind: 'failed', message: 'Traceroute is not supported on this platform yet.' };
    }
    const reader: TraceOutputReader = new TraceOutputReader();
    let address: string | undefined;
    const exit: ToolExit = await this.run(request.id, command, (line: string): void => {
      address ??= parseTraceAddress(line);
      const hop: TraceHop | undefined = reader.accept(line);
      if (hop !== undefined) {
        context.send(NetworkToolsChannel.TraceHop, { id: request.id, hop });
      }
    });
    const resolved: { readonly address?: string } = address === undefined ? {} : { address };
    if (exit.cancelled) {
      return { kind: 'cancelled', ...resolved };
    }
    if (exit.code === 0) {
      return { kind: 'completed', ...resolved };
    }
    return {
      kind: 'failed',
      ...resolved,
      message:
        exit.startError ?? exit.lastError ?? `Traceroute exited with code ${String(exit.code)}.`,
    };
  }

  /**
   * Runs a tool to its end, handing each line it writes — to either stream — to a reader.
   * @param id The run's id.
   * @param command The tool and its arguments.
   * @param onLine Reads one line.
   * @returns Returns a promise resolving how the process ended.
   */
  private async run(
    id: string,
    command: NetworkToolCommand,
    onLine: (line: string) => void,
  ): Promise<ToolExit> {
    if (this.running.has(id)) {
      return { code: null, lastError: undefined, cancelled: false, startError: 'Already running.' };
    }
    if (this.running.size >= MAX_RUNNING) {
      return {
        code: null,
        lastError: undefined,
        cancelled: false,
        startError: 'Too many runs are going at once; stop one first.',
      };
    }
    const child: ChildProcess = this.spawner(command.command, command.args);
    this.running.set(id, child);
    let lastError: string | undefined;
    // Each stream's reader closes itself once the stream ends; waited on from the start, so a reader
    // that has already closed by the time the process does is not waited on forever.
    const drained: Promise<void>[] = [];
    if (child.stdout !== null) {
      const reader: Interface = createInterface({ input: child.stdout });
      reader.on('line', onLine);
      drained.push(closedOf(reader));
    }
    if (child.stderr !== null) {
      const reader: Interface = createInterface({ input: child.stderr });
      reader.on('line', (line: string): void => {
        if (line.trim().length > 0 && parseTraceAddress(line) === undefined) {
          lastError = line.trim();
        }
        onLine(line);
      });
      drained.push(closedOf(reader));
    }
    const ended: { code: number | null; startError: string | undefined } = await new Promise<{
      code: number | null;
      startError: string | undefined;
    }>((resolve: (value: { code: number | null; startError: string | undefined }) => void): void => {
      child.once('error', (error: Error): void =>
        resolve({ code: null, startError: `Could not start ${command.command}: ${error.message}` }),
      );
      child.once('close', (code: number | null): void => resolve({ code, startError: undefined }));
    });
    // A process that never started has no streams to end; one that ran may still hold a last line.
    if (ended.startError === undefined) {
      await Promise.all(drained);
    }
    this.running.delete(id);
    const cancelled: boolean = this.cancelled.delete(id);
    return { code: ended.code, lastError, cancelled, startError: ended.startError };
  }

  /**
   * Stops a run. `ping` is interrupted rather than killed, the way Ctrl-C stops it.
   * @param id The run's id.
   */
  private cancel(id: string): void {
    const child: ChildProcess | undefined = this.running.get(id);
    if (child === undefined) {
      return;
    }
    this.cancelled.add(id);
    child.kill('SIGINT');
  }
}

/**
 * The singleton network-tools contribution appended to the `mainContributions` manifest.
 */
export const networkToolsContribution: MainContribution = new NetworkToolsContribution();
