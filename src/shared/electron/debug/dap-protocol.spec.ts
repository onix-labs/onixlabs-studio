import type { DebugProtocol } from '@vscode/debugprotocol';
import { describe, expect, it } from 'vitest';
import { DapMessageDecoder, DapProtocol, encodeMessage } from './dap-protocol';

/**
 * Encodes a message and returns its bytes, as a stream would deliver them.
 * @param message The message to encode.
 * @returns Returns the encoded bytes.
 */
function bytes(message: DebugProtocol.ProtocolMessage): Uint8Array {
  return new TextEncoder().encode(encodeMessage(message));
}

/**
 * Builds a response message.
 * @param requestSeq The sequence of the request being answered.
 * @param command The command answered.
 * @param overrides Extra fields (success, body, message).
 * @returns Returns the response.
 */
function response(
  requestSeq: number,
  command: string,
  overrides: Partial<DebugProtocol.Response> = {},
): DebugProtocol.Response {
  return {
    seq: 0,
    type: 'response',
    request_seq: requestSeq,
    success: true,
    command,
    ...overrides,
  };
}

describe('encodeMessage', () => {
  it('framesWithAByteCountedContentLengthHeader', () => {
    const encoded: string = encodeMessage({
      seq: 1,
      type: 'event',
      event: 'x',
    } as DebugProtocol.Event);
    const [header, body]: string[] = encoded.split('\r\n\r\n');
    expect(header).toBe(`Content-Length: ${new TextEncoder().encode(body).length}`);
    expect(JSON.parse(body)).toEqual({ seq: 1, type: 'event', event: 'x' });
  });

  it('countsBytesNotCharactersForMultiByteBodies', () => {
    // A message whose body contains a 4-byte emoji must advertise the byte length, not the shorter
    // character length, or the decoder would slice the frame short.
    const encoded: string = encodeMessage({
      seq: 1,
      type: 'event',
      event: 'output',
      body: { output: '🐛' },
    } as DebugProtocol.Event);
    const body: string = encoded.split('\r\n\r\n')[1];
    const declared: number = Number(/Content-Length: (\d+)/.exec(encoded)![1]);
    expect(declared).toBe(new TextEncoder().encode(body).length);
    expect(declared).toBeGreaterThan(body.length);
  });
});

describe('DapMessageDecoder', () => {
  it('decodesASingleWholeMessage', () => {
    const decoder: DapMessageDecoder = new DapMessageDecoder();
    const messages: DebugProtocol.ProtocolMessage[] = decoder.append(
      bytes({ seq: 1, type: 'event', event: 'initialized' } as DebugProtocol.Event),
    );
    expect(messages).toEqual([{ seq: 1, type: 'event', event: 'initialized' }]);
  });

  it('reassemblesAMessageSplitAcrossChunks', () => {
    const decoder: DapMessageDecoder = new DapMessageDecoder();
    const whole: Uint8Array = bytes(
      response(1, 'initialize', { body: { supportsStepBack: true } }),
    );
    const first: Uint8Array = whole.subarray(0, 12);
    const second: Uint8Array = whole.subarray(12);
    expect(decoder.append(first)).toEqual([]);
    const messages: DebugProtocol.ProtocolMessage[] = decoder.append(second);
    expect(messages).toHaveLength(1);
    expect((messages[0] as DebugProtocol.Response).body).toEqual({ supportsStepBack: true });
  });

  it('decodesMultipleMessagesArrivingInOneChunk', () => {
    const decoder: DapMessageDecoder = new DapMessageDecoder();
    const a: Uint8Array = bytes({ seq: 1, type: 'event', event: 'a' } as DebugProtocol.Event);
    const b: Uint8Array = bytes({ seq: 2, type: 'event', event: 'b' } as DebugProtocol.Event);
    const combined: Uint8Array = new Uint8Array(a.length + b.length);
    combined.set(a, 0);
    combined.set(b, a.length);
    const messages: DebugProtocol.ProtocolMessage[] = decoder.append(combined);
    expect(messages.map((m) => (m as DebugProtocol.Event).event)).toEqual(['a', 'b']);
  });

  it('honoursByteCountedLengthWhenAMultiByteCharacterStraddlesChunks', () => {
    const decoder: DapMessageDecoder = new DapMessageDecoder();
    const whole: Uint8Array = bytes({
      seq: 1,
      type: 'event',
      event: 'output',
      body: { output: '🐛🐛' },
    } as DebugProtocol.Event);
    // Split inside the emoji's multi-byte sequence; the decoder must still yield exactly one message.
    const cut: number = whole.length - 3;
    expect(decoder.append(whole.subarray(0, cut))).toEqual([]);
    const messages: DebugProtocol.ProtocolMessage[] = decoder.append(whole.subarray(cut));
    expect((messages[0] as DebugProtocol.Event).body).toEqual({ output: '🐛🐛' });
  });

  it('parsesTheContentLengthHeaderCaseInsensitively', () => {
    const decoder: DapMessageDecoder = new DapMessageDecoder();
    const body: string = JSON.stringify({ seq: 1, type: 'event', event: 'x' });
    const framed: string = `content-length: ${new TextEncoder().encode(body).length}\r\n\r\n${body}`;
    const messages: DebugProtocol.ProtocolMessage[] = decoder.append(
      new TextEncoder().encode(framed),
    );
    expect(messages).toHaveLength(1);
  });
});

describe('DapProtocol', () => {
  it('stampsAscendingSequenceNumbersOnOutgoingRequests', () => {
    const sent: DebugProtocol.ProtocolMessage[] = [];
    const protocol: DapProtocol = new DapProtocol((m) => sent.push(m));
    void protocol.sendRequest('initialize');
    void protocol.sendRequest('launch');
    expect(sent.map((m) => m.seq)).toEqual([1, 2]);
    expect((sent[0] as DebugProtocol.Request).command).toBe('initialize');
  });

  it('resolvesARequestWhenItsResponseArrives', async () => {
    const sent: DebugProtocol.ProtocolMessage[] = [];
    const protocol: DapProtocol = new DapProtocol((m) => sent.push(m));
    const pending: Promise<DebugProtocol.Capabilities> =
      protocol.sendRequest<DebugProtocol.Capabilities>('initialize');
    protocol.handleMessage(
      response(sent[0].seq, 'initialize', { body: { supportsStepBack: true } }),
    );
    await expect(pending).resolves.toEqual({ supportsStepBack: true });
  });

  it('rejectsARequestWhenItsResponseReportsFailure', async () => {
    const sent: DebugProtocol.ProtocolMessage[] = [];
    const protocol: DapProtocol = new DapProtocol((m) => sent.push(m));
    const pending: Promise<unknown> = protocol.sendRequest('launch');
    protocol.handleMessage(
      response(sent[0].seq, 'launch', { success: false, message: 'no such program' }),
    );
    await expect(pending).rejects.toThrow('no such program');
  });

  it('correlatesResponsesToTheRightRequestOutOfOrder', async () => {
    const sent: DebugProtocol.ProtocolMessage[] = [];
    const protocol: DapProtocol = new DapProtocol((m) => sent.push(m));
    const first: Promise<{ n: number }> = protocol.sendRequest<{ n: number }>('a');
    const second: Promise<{ n: number }> = protocol.sendRequest<{ n: number }>('b');
    protocol.handleMessage(response(sent[1].seq, 'b', { body: { n: 2 } }));
    protocol.handleMessage(response(sent[0].seq, 'a', { body: { n: 1 } }));
    expect(await first).toEqual({ n: 1 });
    expect(await second).toEqual({ n: 2 });
  });

  it('deliversEventsToListeners', () => {
    const protocol: DapProtocol = new DapProtocol(() => undefined);
    const events: string[] = [];
    protocol.onEvent((e) => events.push(e.event));
    protocol.handleMessage({ seq: 5, type: 'event', event: 'stopped' } as DebugProtocol.Event);
    expect(events).toEqual(['stopped']);
  });

  it('stopsDeliveringAfterAListenerIsDisposed', () => {
    const protocol: DapProtocol = new DapProtocol(() => undefined);
    const events: string[] = [];
    const dispose: () => void = protocol.onEvent((e) => events.push(e.event));
    dispose();
    protocol.handleMessage({ seq: 5, type: 'event', event: 'stopped' } as DebugProtocol.Event);
    expect(events).toEqual([]);
  });

  it('deliversReverseRequestsAndCanRespond', () => {
    const sent: DebugProtocol.ProtocolMessage[] = [];
    const protocol: DapProtocol = new DapProtocol((m) => sent.push(m));
    const seen: DebugProtocol.Request[] = [];
    protocol.onReverseRequest((r) => seen.push(r));
    const reverse: DebugProtocol.Request = {
      seq: 9,
      type: 'request',
      command: 'runInTerminal',
    };
    protocol.handleMessage(reverse);
    expect(seen).toHaveLength(1);
    protocol.respondTo(reverse, { processId: 1 });
    const answer: DebugProtocol.Response = sent[0] as DebugProtocol.Response;
    expect(answer.request_seq).toBe(9);
    expect(answer.success).toBe(true);
    expect(answer.command).toBe('runInTerminal');
  });

  it('ignoresAResponseThatMatchesNoPendingRequest', () => {
    const protocol: DapProtocol = new DapProtocol(() => undefined);
    expect(() => protocol.handleMessage(response(999, 'ghost'))).not.toThrow();
  });

  it('rejectsInFlightRequestsOnDispose', async () => {
    const protocol: DapProtocol = new DapProtocol(() => undefined);
    const pending: Promise<unknown> = protocol.sendRequest('initialize');
    protocol.dispose('closed');
    await expect(pending).rejects.toThrow('closed');
  });
});
