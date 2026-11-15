import { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import {
  CaptureBatch,
  CapturedPacket,
  CaptureEnd,
  CaptureStart,
  NetworkCaptureChannel,
} from '@shared/api/network-capture-channels';
import { LINKTYPE_ETHERNET, PcapRecord } from '@shared/api/packets/packet-model';
import { PcapStreamReader } from '@shared/api/packets/pcap-reader';
import { pcapHeader, pcapRecord } from '@shared/api/packets/pcap-writer';
import {
  bytesOf,
  dnsQuery,
  ethernet,
  hostMac,
  ipv4,
  routerMac,
  tcp,
  udp,
} from '@shared/api/packets/packet-samples.testing';
import { ContributionContext, ContributionListener, InvokeHandler } from '../main-contribution';
import { NetworkCaptureContribution } from './network-capture.contribution';

/**
 * A stand-in for tcpdump: the test writes its output and decides how it ends.
 */
class FakeTcpdump extends EventEmitter {
  /**
   * Gets its standard output, where the pcap stream goes.
   */
  public readonly stdout: PassThrough = new PassThrough();

  /**
   * Gets its standard error, where it says what it is doing.
   */
  public readonly stderr: PassThrough = new PassThrough();

  /**
   * Gets the signals it was sent.
   */
  public readonly signals: string[] = [];

  /**
   * Ends it with an exit code.
   * @param code The exit code.
   */
  public exit(code: number): void {
    this.stdout.end();
    this.stderr.end();
    setTimeout((): void => void this.emit('close', code), 5);
  }

  /**
   * Records a signal, and exits as tcpdump does on Ctrl-C.
   * @param signal The signal.
   * @returns Returns true.
   */
  public kill(signal: string): boolean {
    this.signals.push(signal);
    this.exit(0);
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
   * Invokes a channel as the renderer would.
   * @param channel The channel.
   * @param payload The payload.
   * @returns Returns the handler's answer.
   */
  public invoke<T>(channel: string, payload: unknown): Promise<T> {
    return this.handlers.get(channel)!({} as never, payload) as Promise<T>;
  }

  /**
   * Sends to a listener as the renderer would.
   * @param channel The channel.
   * @param payload The payload.
   */
  public emit(channel: string, payload: unknown): void {
    this.listeners.get(channel)!({} as never, payload);
  }

  /**
   * Gets the payloads sent on a channel.
   * @param channel The channel.
   * @returns Returns them, in order.
   */
  public payloads<T>(channel: string): readonly T[] {
    return this.sent
      .filter((message): boolean => message.channel === channel)
      .map((message): T => message.payload as T);
  }
}

/**
 * Builds a record of an Ethernet frame.
 * @param timestampMs When it was captured.
 * @param frame The frame.
 * @returns Returns the record.
 */
function record(timestampMs: number, frame: Uint8Array): PcapRecord {
  return { timestampMs, originalLength: frame.length, data: frame };
}

/**
 * A capture of a DNS query and a TCP SYN, as tcpdump would write it.
 */
const capture: Uint8Array = bytesOf(
  pcapHeader(LINKTYPE_ETHERNET),
  pcapRecord(
    record(
      1_000,
      ethernet(
        hostMac,
        routerMac,
        0x0800,
        ipv4('192.168.1.43', '192.168.1.1', 17, udp(53000, 53, dnsQuery(7, 'github.com'))),
      ),
    ),
  ),
  pcapRecord(
    record(
      2_000,
      ethernet(
        hostMac,
        routerMac,
        0x0800,
        ipv4('192.168.1.43', '140.82.112.3', 6, tcp(50000, 443, 0x02)),
      ),
    ),
  ),
);

describe('NetworkCaptureContribution', () => {
  let directory: string;
  let context: FakeContext;
  let spawned: { command: string; args: readonly string[]; process: FakeTcpdump }[];
  let contribution: NetworkCaptureContribution;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'network-capture-'));
    context = new FakeContext();
    spawned = [];
    contribution = new NetworkCaptureContribution(
      (command: string, args: readonly string[]): ChildProcess => {
        const process: FakeTcpdump = new FakeTcpdump();
        spawned.push({ command, args, process });
        return process as unknown as ChildProcess;
      },
      'darwin',
      join(directory, 'live'),
    );
    contribution.activate(context as unknown as ContributionContext);
  });

  afterEach(async () => {
    await contribution.dispose();
    await rm(directory, { recursive: true, force: true });
  });

  /**
   * Waits for tcpdump to be started, which follows the capture's folder being made.
   * @returns Returns a promise resolving the fake tcpdump.
   */
  async function startedTcpdump(): Promise<FakeTcpdump> {
    for (let tries: number = 0; spawned.length === 0 && tries < 100; tries += 1) {
      await new Promise<void>((resolve: () => void): void => void setTimeout(resolve, 5));
    }
    return spawned[0].process;
  }

  /**
   * Waits for a batch to go out.
   */
  async function nextBatch(): Promise<void> {
    await new Promise<void>((resolve: () => void): void => void setTimeout(resolve, 260));
  }

  it('aLiveCapture_streamsSummaries_servesPackets_andSaves', async () => {
    const started: Promise<CaptureStart> = context.invoke<CaptureStart>(
      NetworkCaptureChannel.Start,
      {
        id: 'c1',
        interfaceId: 'en0',
        filter: 'udp or tcp',
      },
    );
    const tcpdump: FakeTcpdump = await startedTcpdump();
    tcpdump.stderr.write('tcpdump: listening on en0, link-type EN10MB (Ethernet)\n');
    expect(await started).toEqual({ kind: 'started' });
    expect(spawned[0].args).toEqual([
      '-i',
      'en0',
      '-n',
      '-U',
      '-s',
      '0',
      '-w',
      '-',
      '--',
      'udp or tcp',
    ]);

    // Arriving in awkward pieces, as a pipe delivers it.
    tcpdump.stdout.write(capture.subarray(0, 30));
    tcpdump.stdout.write(capture.subarray(30));
    await nextBatch();

    const batches: readonly CaptureBatch[] = context.payloads<CaptureBatch>(
      NetworkCaptureChannel.Packets,
    );
    expect(
      batches.flatMap((batch: CaptureBatch) => batch.packets.map((packet) => packet.summary.info)),
    ).toEqual(['Standard query 0x0007 A github.com', '50000 → 443 [SYN] Seq=1000 Win=65535 Len=0']);
    const packet: CapturedPacket | null = await context.invoke<CapturedPacket | null>(
      NetworkCaptureChannel.Packet,
      {
        id: 'c1',
        number: 2,
      },
    );
    expect(packet?.linkType).toBe(LINKTYPE_ETHERNET);
    expect(packet?.data.length).toBeGreaterThan(50);

    const saved: string = join(directory, 'saved.pcap');
    expect(
      await context.invoke<boolean>(NetworkCaptureChannel.Save, { id: 'c1', path: saved }),
    ).toBe(true);
    expect(new PcapStreamReader().push(await readFile(saved))).toHaveLength(2);

    context.emit(NetworkCaptureChannel.Stop, 'c1');
    await nextBatch();
    expect(tcpdump.signals).toEqual(['SIGINT']);
    expect(context.payloads<CaptureEnd>(NetworkCaptureChannel.Ended)).toEqual([{ id: 'c1' }]);

    context.emit(NetworkCaptureChannel.Release, 'c1');
    await nextBatch();
    expect(await readdir(join(directory, 'live'))).toEqual([]);
  });

  it('aCaptureWithoutPermission_failsSayingSo', async () => {
    const started: Promise<CaptureStart> = context.invoke<CaptureStart>(
      NetworkCaptureChannel.Start,
      {
        id: 'c1',
        interfaceId: 'en0',
        filter: '',
      },
    );
    const tcpdump: FakeTcpdump = await startedTcpdump();
    tcpdump.stderr.write(
      "tcpdump: en0: You don't have permission to capture on that device\n((cannot open BPF device) /dev/bpf0: Permission denied)\n",
    );
    tcpdump.exit(1);

    expect(await started).toEqual({
      kind: 'failed',
      message: '((cannot open BPF device) /dev/bpf0: Permission denied)',
      permission: true,
    });
  });

  it('anInterfaceThatIsAnOption_isRefused_withoutRunningAnything', async () => {
    const started: CaptureStart = await context.invoke<CaptureStart>(NetworkCaptureChannel.Start, {
      id: 'c1',
      interfaceId: '-w',
      filter: '',
    });

    expect(started.kind).toBe('failed');
    expect(spawned).toHaveLength(0);
  });

  it('aCaptureFile_isReadLikeALiveCapture_andEnds', async () => {
    const file: string = join(directory, 'sample.pcap');
    await writeFile(file, capture);

    expect(
      await context.invoke<CaptureStart>(NetworkCaptureChannel.Open, { id: 'f1', path: file }),
    ).toEqual({
      kind: 'started',
    });
    await nextBatch();

    const rows: number = context
      .payloads<CaptureBatch>(NetworkCaptureChannel.Packets)
      .reduce((sum: number, batch: CaptureBatch): number => sum + batch.packets.length, 0);
    expect(rows).toBe(2);
    expect(context.payloads<CaptureEnd>(NetworkCaptureChannel.Ended)).toEqual([{ id: 'f1' }]);
    expect(await readFile(file)).toEqual(Buffer.from(capture));
  });

  it('aFileThatIsNotACapture_failsToOpen', async () => {
    const file: string = join(directory, 'notes.txt');
    await writeFile(file, 'not a capture at all, just some notes');

    const started: CaptureStart = await context.invoke<CaptureStart>(NetworkCaptureChannel.Open, {
      id: 'f1',
      path: file,
    });

    expect(started).toEqual({
      kind: 'failed',
      message: 'The stream is not a pcap capture',
      permission: false,
    });
  });
});
