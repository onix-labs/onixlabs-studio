import { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import {
  NetworkToolsChannel,
  PingOutcome,
  PingReplyEvent,
  TraceHopEvent,
  TraceOutcome,
} from '@shared/api/network-tools-channels';
import {
  ContributionContext,
  ContributionListener,
  InvokeHandler,
} from '../main-contribution';
import { NetworkToolsContribution, readPingRequest, readTraceRequest } from './network-tools.contribution';

/**
 * A stand-in for a tool's process: the test writes its output and decides how it ends.
 */
class FakeProcess extends EventEmitter {
  /**
   * Gets the process's standard output.
   */
  public readonly stdout: PassThrough = new PassThrough();

  /**
   * Gets the process's standard error.
   */
  public readonly stderr: PassThrough = new PassThrough();

  /**
   * Gets the signals it was sent.
   */
  public readonly signals: string[] = [];

  /**
   * Writes lines to standard output.
   * @param lines The lines.
   */
  public print(...lines: readonly string[]): void {
    this.stdout.write(lines.map((line: string): string => `${line}\n`).join(''));
  }

  /**
   * Writes lines to standard error.
   * @param lines The lines.
   */
  public complain(...lines: readonly string[]): void {
    this.stderr.write(lines.map((line: string): string => `${line}\n`).join(''));
  }

  /**
   * Ends the streams and the process with an exit code.
   * @param code The exit code.
   */
  public exit(code: number | null): void {
    this.stdout.end();
    this.stderr.end();
    setTimeout((): void => void this.emit('close', code), 5);
  }

  /**
   * Records a signal, and ends as an interrupted tool does.
   * @param signal The signal.
   * @returns Returns true.
   */
  public kill(signal: string): boolean {
    this.signals.push(signal);
    this.exit(null);
    return true;
  }
}

/**
 * A contribution context that records handlers and what was sent.
 */
class FakeContext {
  /**
   * Gets the invoke handlers, by channel.
   */
  public readonly handlers: Map<string, InvokeHandler> = new Map<string, InvokeHandler>();

  /**
   * Gets the listeners, by channel.
   */
  public readonly listeners: Map<string, ContributionListener> = new Map<
    string,
    ContributionListener
  >();

  /**
   * Gets every message sent, in order.
   */
  public readonly sent: { readonly channel: string; readonly payload: unknown }[] = [];

  /**
   * Gets the logger, which discards.
   */
  public readonly log: ContributionContext['log'] = {
    error: (): void => undefined,
    warn: (): void => undefined,
    info: (): void => undefined,
  };

  /**
   * Records a handler.
   * @param channel The channel.
   * @param handler The handler.
   */
  public handle(channel: string, handler: InvokeHandler): void {
    this.handlers.set(channel, handler);
  }

  /**
   * Records a listener.
   * @param channel The channel.
   * @param listener The listener.
   */
  public on(channel: string, listener: ContributionListener): void {
    this.listeners.set(channel, listener);
  }

  /**
   * Records a message.
   * @param channel The channel.
   * @param payload The payload.
   */
  public send(channel: string, ...payload: unknown[]): void {
    this.sent.push({ channel, payload: payload[0] });
  }

  /**
   * Answers no permission.
   * @returns Returns nothing.
   */
  public permission(): never {
    throw new Error('No permissions in tests');
  }

  /**
   * Answers no window.
   * @returns Returns null.
   */
  public mainWindow(): null {
    return null;
  }

  /**
   * Invokes a channel as the renderer would.
   * @param channel The channel.
   * @param payload The payload.
   * @returns Returns the handler's answer.
   */
  public invoke<T>(channel: string, payload: unknown): Promise<T> {
    return this.handlers.get(channel)!({} as never, payload) as Promise<T>;
  }
}

describe('NetworkToolsContribution', () => {
  let context: FakeContext;
  let spawned: { command: string; args: readonly string[]; process: FakeProcess }[];

  beforeEach(() => {
    context = new FakeContext();
    spawned = [];
    const contribution: NetworkToolsContribution = new NetworkToolsContribution(
      (command: string, args: readonly string[]): ChildProcess => {
        const process: FakeProcess = new FakeProcess();
        spawned.push({ command, args, process });
        return process as unknown as ChildProcess;
      },
      'darwin',
    );
    contribution.activate(context);
  });

  /**
   * Waits for the contribution to pick up output.
   */
  async function settle(): Promise<void> {
    await new Promise<void>((resolve: () => void): void => void setTimeout(resolve, 10));
  }

  it('ping_streamsEachReply_andCompletes', async () => {
    const outcome: Promise<PingOutcome> = context.invoke<PingOutcome>(NetworkToolsChannel.Ping, {
      id: 'p1',
      host: '1.1.1.1',
      count: 2,
    });
    const tool: FakeProcess = spawned[0].process;
    tool.print(
      'PING 1.1.1.1 (1.1.1.1): 56 data bytes',
      '64 bytes from 1.1.1.1: icmp_seq=0 ttl=57 time=13.979 ms',
      'Request timeout for icmp_seq 1',
      '',
      '--- 1.1.1.1 ping statistics ---',
      '3 packets transmitted, 1 packets received, 66.7% packet loss',
    );
    await settle();
    tool.exit(2);

    expect(await outcome).toEqual({ kind: 'completed', address: '1.1.1.1', transmitted: 3 });
    expect(spawned[0].command).toBe('/sbin/ping');
    expect(
      context.sent.map((message): PingReplyEvent => message.payload as PingReplyEvent),
    ).toEqual([
      { id: 'p1', reply: { sequence: 0, address: '1.1.1.1', ttl: 57, rttMs: 13.979 } },
      { id: 'p1', reply: { sequence: 1 } },
    ]);
  });

  it('ping_failsWithWhatTheToolSaid', async () => {
    const outcome: Promise<PingOutcome> = context.invoke<PingOutcome>(NetworkToolsChannel.Ping, {
      id: 'p1',
      host: 'no-such-host.invalid',
      count: 1,
    });
    spawned[0].process.complain('ping: cannot resolve no-such-host.invalid: Unknown host');
    await settle();
    spawned[0].process.exit(68);

    expect(await outcome).toEqual({
      kind: 'failed',
      message: 'ping: cannot resolve no-such-host.invalid: Unknown host',
    });
  });

  it('ping_refusesAnOption_withoutRunningAnything', async () => {
    const outcome: PingOutcome = await context.invoke<PingOutcome>(NetworkToolsChannel.Ping, {
      id: 'p1',
      host: '-f',
      count: 1,
    });

    expect(outcome.kind).toBe('failed');
    expect(spawned).toHaveLength(0);
  });

  it('cancel_interruptsTheRun_whichEndsCancelled', async () => {
    const outcome: Promise<PingOutcome> = context.invoke<PingOutcome>(NetworkToolsChannel.Ping, {
      id: 'p1',
      host: '1.1.1.1',
      count: 100,
    });

    context.listeners.get(NetworkToolsChannel.Cancel)!({} as never, 'p1');

    expect((await outcome).kind).toBe('cancelled');
    expect(spawned[0].process.signals).toEqual(['SIGINT']);
  });

  it('trace_streamsHopsAsTheyGrow_andReadsTheHeaderFromStandardError', async () => {
    const outcome: Promise<TraceOutcome> = context.invoke<TraceOutcome>(NetworkToolsChannel.Trace, {
      id: 't1',
      host: '1.1.1.1',
      maxHops: 30,
    });
    const tool: FakeProcess = spawned[0].process;
    tool.complain('traceroute to 1.1.1.1 (1.1.1.1), 30 hops max, 40 byte packets');
    tool.print(' 1  192.168.1.1  4.884 ms  4.851 ms  4.920 ms');
    tool.print(' 2  141.101.71.174  15.617 ms  17.027 ms', '    141.101.71.175  15.719 ms');
    await settle();
    tool.exit(0);

    expect(await outcome).toEqual({ kind: 'completed', address: '1.1.1.1' });
    const hops: readonly TraceHopEvent[] = context.sent.map(
      (message): TraceHopEvent => message.payload as TraceHopEvent,
    );
    expect(hops.map((event: TraceHopEvent): number => event.hop.index)).toEqual([1, 2, 2]);
    expect(hops[2].hop.probes).toHaveLength(3);
    expect(spawned[0].args).toEqual(['-n', '-q', '3', '-w', '2', '-m', '30', '1.1.1.1']);
  });

  it('aRunThatCannotStart_failsWithWhy', async () => {
    const outcome: Promise<TraceOutcome> = context.invoke<TraceOutcome>(NetworkToolsChannel.Trace, {
      id: 't1',
      host: '1.1.1.1',
      maxHops: 30,
    });
    spawned[0].process.emit('error', new Error('spawn ENOENT'));

    expect(await outcome).toEqual({
      kind: 'failed',
      message: 'Could not start /usr/sbin/traceroute: spawn ENOENT',
    });
  });

  it('readRequests_refuseOutOfRangeCounts', () => {
    expect(readPingRequest({ id: 'a', host: '1.1.1.1', count: 0 })).toBeUndefined();
    expect(readPingRequest({ id: 'a', host: '1.1.1.1', count: 101 })).toBeUndefined();
    expect(readTraceRequest({ id: 'a', host: '1.1.1.1', maxHops: 65 })).toBeUndefined();
    expect(readTraceRequest({ id: '', host: '1.1.1.1', maxHops: 30 })).toBeUndefined();
    expect(readTraceRequest({ id: 'a', host: '1.1.1.1', maxHops: 30 })).toEqual({
      id: 'a',
      host: '1.1.1.1',
      maxHops: 30,
    });
  });
});
