import type { DebugProtocol } from '@vscode/debugprotocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DapClient } from './dap-client';
import { encodeMessage } from './dap-protocol';
import { DapTransport } from './dap-transport';

/**
 * A transport held in memory, recording what the client sends.
 */
class FakeTransport implements DapTransport {
  public readonly sent: DebugProtocol.ProtocolMessage[] = [];
  public disposals: number = 0;
  public failure: Error | null = null;
  private dataListener: ((chunk: Uint8Array) => void) | null = null;
  private closeListener: ((code: number | null, signal: string | null) => void) | null = null;

  public start(): Promise<void> {
    return this.failure === null ? Promise.resolve() : Promise.reject(this.failure);
  }

  public send(framed: string): void {
    this.sent.push(JSON.parse(framed.split('\r\n\r\n')[1]) as DebugProtocol.ProtocolMessage);
  }

  public onData(listener: (chunk: Uint8Array) => void): void {
    this.dataListener = listener;
  }

  public onClose(listener: (code: number | null, signal: string | null) => void): void {
    this.closeListener = listener;
  }

  public dispose(): void {
    this.disposals += 1;
  }

  public receive(...messages: readonly DebugProtocol.ProtocolMessage[]): void {
    this.bytes(messages.map(encodeMessage).join(''));
  }

  public bytes(text: string): void {
    this.dataListener?.(new TextEncoder().encode(text));
  }

  public close(code: number | null, signal: string | null): void {
    this.closeListener?.(code, signal);
  }

  public answerLast(body?: unknown): void {
    const last: DebugProtocol.ProtocolMessage | undefined = this.sent.at(-1);
    this.receive({
      seq: 100,
      type: 'response',
      request_seq: last?.seq ?? 0,
      success: true,
      command: 'x',
      body,
    } as DebugProtocol.Response);
  }
}

describe('DapClient', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * Starts a client over a fake transport.
   * @returns Returns both.
   */
  async function started(): Promise<{ client: DapClient; transport: FakeTransport }> {
    const transport: FakeTransport = new FakeTransport();
    const client: DapClient = new DapClient(transport);
    await client.start();
    return { client, transport };
  }

  it('advertisesTheCapabilitiesTheCompoundSessionAndTerminalsNeed', async () => {
    const { client, transport }: { client: DapClient; transport: FakeTransport } = await started();

    const initialized: Promise<DebugProtocol.Capabilities> = client.initialize('js-debug');
    transport.answerLast({ supportsConfigurationDoneRequest: true });

    expect(await initialized).toEqual({ supportsConfigurationDoneRequest: true });
    expect(transport.sent[0]).toMatchObject({
      command: 'initialize',
      arguments: {
        adapterID: 'js-debug',
        supportsRunInTerminalRequest: true,
        supportsStartDebuggingRequest: true,
      },
    });
  });

  it('readsAnInitializeAnsweredWithNoBody_asNoCapabilities', async () => {
    const { client, transport }: { client: DapClient; transport: FakeTransport } = await started();

    const initialized: Promise<DebugProtocol.Capabilities> = client.initialize('js-debug');
    transport.answerLast();

    expect(await initialized).toEqual({});
  });

  it('givesUpOnAnAdapterThatNeverAnswersInitialize', async () => {
    vi.useFakeTimers();
    const { client }: { client: DapClient } = await started();

    const failed: Promise<void> = expect(client.initialize('js-debug')).rejects.toThrow(
      'did not complete initialization in time',
    );
    await vi.advanceTimersByTimeAsync(30_000);

    await failed;
  });

  it('passesOnAFailedInitialize_withTheAdaptersMessage', async () => {
    const { client, transport }: { client: DapClient; transport: FakeTransport } = await started();

    const initialized: Promise<DebugProtocol.Capabilities> = client.initialize('js-debug');
    transport.receive({
      seq: 1,
      type: 'response',
      request_seq: 1,
      success: false,
      command: 'initialize',
      message: 'unsupported',
    } as DebugProtocol.Response);

    await expect(initialized).rejects.toThrow('unsupported');
  });

  it('rejectsWhatIsInFlight_andTellsListeners_whenTheConnectionCloses', async () => {
    const { client, transport }: { client: DapClient; transport: FakeTransport } = await started();
    const exits: (number | null)[] = [];
    client.onExit((code: number | null): void => void exits.push(code));
    const removed: () => void = client.onExit((): void => void exits.push(-1));
    removed();

    const pending: Promise<unknown> = client.sendRequest('threads');
    transport.close(3, null);

    await expect(pending).rejects.toThrow('connection closed');
    expect(exits).toEqual([3]);
  });

  it('rejectsWhatIsInFlight_whenDisposed_andDisposesTheTransportEachTime', async () => {
    const { client, transport }: { client: DapClient; transport: FakeTransport } = await started();

    const pending: Promise<unknown> = client.sendRequest('threads');
    client.dispose();
    client.dispose();

    await expect(pending).rejects.toThrow('connection was closed');
    expect(transport.disposals).toBe(2);
  });

  it('deliversAMessageSplitAcrossChunks', async () => {
    const { client, transport }: { client: DapClient; transport: FakeTransport } = await started();
    const events: string[] = [];
    client.onEvent((event: DebugProtocol.Event): void => void events.push(event.event));
    const framed: string = encodeMessage({
      seq: 1,
      type: 'event',
      event: 'stopped',
    } as DebugProtocol.Event);

    transport.bytes(framed.slice(0, 10));
    expect(events).toEqual([]);
    transport.bytes(framed.slice(10));

    expect(events).toEqual(['stopped']);
  });

  it('startFails_whenTheTransportCannotBeEstablished', async () => {
    const transport: FakeTransport = new FakeTransport();
    transport.failure = new Error('spawn ENOENT');

    await expect(new DapClient(transport).start()).rejects.toThrow('spawn ENOENT');
  });

  it('answersARunInTerminalOnItsOwnConnection_andOffersNoOtherReverseRequest', async () => {
    const { client, transport }: { client: DapClient; transport: FakeTransport } = await started();
    const asked: string[] = [];
    client.onRunInTerminal(
      (
        request: DebugProtocol.Request,
        respond: (body?: unknown, success?: boolean) => void,
      ): void => {
        asked.push(request.command);
        respond({ processId: 42 });
      },
    );

    transport.receive(
      { seq: 5, type: 'request', command: 'startDebugging' } as DebugProtocol.Request,
      { seq: 6, type: 'request', command: 'runInTerminal' } as DebugProtocol.Request,
    );

    expect(asked).toEqual(['runInTerminal']);
    expect(transport.sent).toEqual([
      expect.objectContaining({
        type: 'response',
        request_seq: 6,
        success: true,
        body: { processId: 42 },
      }),
    ]);
  });
});
