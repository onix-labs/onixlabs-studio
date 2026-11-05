import type { DebugProtocol } from '@vscode/debugprotocol';
import { describe, expect, it } from 'vitest';
import {
  DapMessageDecoder,
  DapProtocol,
  MAX_DAP_BODY_BYTES,
  MAX_DAP_HEADER_BYTES,
  encodeMessage,
} from './dap-protocol';

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

describe('DapMessageDecoder on a misbehaving stream', () => {
  /**
   * Frames a message.
   * @param seq The sequence number that identifies it.
   * @returns Returns the framed text.
   */
  function frame(seq: number): string {
    return encodeMessage({ seq, type: 'event' });
  }

  /**
   * Decodes text, as one chunk.
   * @param text The text.
   * @param decoder The decoder, when a spec carries on with one.
   * @returns Returns the sequence numbers decoded.
   */
  function decode(text: string, decoder: DapMessageDecoder = new DapMessageDecoder()): number[] {
    return decoder
      .append(new TextEncoder().encode(text))
      .map((message: { seq: number }): number => message.seq);
  }

  it('reassemblesAHeaderSplitInsideTheTerminator', () => {
    const decoder: DapMessageDecoder = new DapMessageDecoder();
    const text: string = frame(1);
    const middle: number = text.indexOf('\r\n\r\n') + 2;

    expect(decode(text.slice(0, middle), decoder)).toEqual([]);
    expect(decode(text.slice(middle), decoder)).toEqual([1]);
  });

  it('survivesAFeedOfOneByteAtATime', () => {
    const decoder: DapMessageDecoder = new DapMessageDecoder();

    const seen: number[] = [...`${frame(1)}${frame(2)}`].flatMap((character: string): number[] =>
      decode(character, decoder),
    );

    expect(seen).toEqual([1, 2]);
  });

  it('dropsAFrameDeclaringAnImpossibleLength_ratherThanWaitingForItsBody', () => {
    const decoder: DapMessageDecoder = new DapMessageDecoder();
    const event: DebugProtocol.Event = { seq: 1, type: 'event', event: 'stopped' };
    const huge: Uint8Array = new TextEncoder().encode(
      `Content-Length: ${MAX_DAP_BODY_BYTES + 1}\r\n\r\n`,
    );

    expect(decoder.append(huge)).toEqual([]);

    expect(decoder.append(bytes(event))).toEqual([event]);
  });

  it('dropsALengthTooLargeToBeANumberAtAll', () => {
    const decoder: DapMessageDecoder = new DapMessageDecoder();
    const event: DebugProtocol.Event = { seq: 1, type: 'event', event: 'stopped' };

    const decoded: DebugProtocol.ProtocolMessage[] = decoder.append(
      new TextEncoder().encode(`Content-Length: ${'9'.repeat(400)}\r\n\r\n${encodeMessage(event)}`),
    );

    expect(decoded).toEqual([event]);
  });

  it('stillWaitsForAFrameAtExactlyTheLimit', () => {
    const decoder: DapMessageDecoder = new DapMessageDecoder();
    const event: DebugProtocol.Event = { seq: 1, type: 'event', event: 'stopped' };

    decoder.append(new TextEncoder().encode(`Content-Length: ${MAX_DAP_BODY_BYTES}\r\n\r\n`));

    expect(decoder.append(bytes(event))).toEqual([]);
  });

  it('doesNotHoardOutputThatNeverReachesAHeader', () => {
    const decoder: DapMessageDecoder = new DapMessageDecoder();
    const event: DebugProtocol.Event = { seq: 1, type: 'event', event: 'stopped' };

    for (let index: number = 0; index < 8; index += 1) {
      expect(decoder.append(new Uint8Array(MAX_DAP_HEADER_BYTES).fill(46))).toEqual([]);
    }

    expect(decoder.append(bytes(event))).toEqual([event]);
    expect(decoder.bufferedBytes).toBe(0);
  });

  it('keepsAHeaderSplitAcrossTheCap', () => {
    const decoder: DapMessageDecoder = new DapMessageDecoder();
    const event: DebugProtocol.Event = { seq: 1, type: 'event', event: 'stopped' };
    const frame: Uint8Array = bytes(event);

    decoder.append(new Uint8Array(MAX_DAP_HEADER_BYTES + 1).fill(46));
    expect(decoder.append(frame.subarray(0, 6))).toEqual([]);

    expect(decoder.append(frame.subarray(6))).toEqual([event]);
  });

  it('readsAnEmptyBodyAsADroppedFrame_andCarriesOn', () => {
    expect(decode(`Content-Length: 0\r\n\r\n${frame(2)}`)).toEqual([2]);
  });

  it.each<[string, string]>([
    ['aWordForALength', 'Content-Length: many'],
    ['aNegativeLength', 'Content-Length: -4'],
    ['aFractionalLength', 'Content-Length: 1.5'],
    ['noLengthAtAll', 'X-Other: 1'],
  ])('dropsAHeaderWith_%s_andDeliversTheFrameBehindIt', (_name: string, header: string) => {
    expect(decode(`${header}\r\n\r\n${frame(2)}${frame(3)}`)).toEqual([2, 3]);
  });

  it('dropsABodyThatIsNotJson_andDeliversTheFrameBehindIt_inTheSameChunk', () => {
    expect(decode(`Content-Length: 4\r\n\r\nnope${frame(2)}`)).toEqual([2]);
  });

  it.each<[string, string]>([
    ['null', 'null'],
    ['aNumber', '7'],
    ['aString', '"x"'],
  ])('dropsABodyThatIs_%s_ratherThanHandingItToTheProtocol', (_name: string, body: string) => {
    expect(decode(`Content-Length: ${body.length}\r\n\r\n${body}${frame(2)}`)).toEqual([2]);
  });

  it('keepsItsPlace_whenAnAdapterPrintsALogLineBeforeAFrame', () => {
    // Stdout is the protocol stream, and adapters and the runtimes under them do write to it.
    const decoder: DapMessageDecoder = new DapMessageDecoder();

    expect(decode(`warning: no symbols\n${frame(1)}`, decoder)).toEqual([1]);
    expect(decode(frame(2), decoder)).toEqual([2]);
  });

  it('recoversTheNextFrame_whenAFrameHadNoUsableLength', () => {
    const decoder: DapMessageDecoder = new DapMessageDecoder();
    const body: string = JSON.stringify({ seq: 1, type: 'event' });

    expect(decode(`Content-Length: bad\r\n\r\n${body}${frame(2)}${frame(3)}`, decoder)).toEqual([
      2, 3,
    ]);
    expect(decode(frame(4), decoder)).toEqual([4]);
  });

  it('holdsOffOnALengthLongerThanWhatHasArrived', () => {
    const decoder: DapMessageDecoder = new DapMessageDecoder();

    expect(decode('Content-Length: 99999999999\r\n\r\n{}', decoder)).toEqual([]);
  });

  it('doesNotTakeALookalikeHeaderForContentLength', () => {
    expect(decode(`X-Content-Length: 2\r\n\r\n${frame(1)}`)).toEqual([1]);
  });
});

describe('DapProtocol failures', () => {
  it('namesTheCommand_whenAFailedResponseCarriesNoMessage', async () => {
    const protocol: DapProtocol = new DapProtocol((): void => undefined);
    const outcome: Promise<unknown> = protocol.sendRequest('launch');

    protocol.handleMessage({
      seq: 9,
      type: 'response',
      request_seq: 1,
      success: false,
      command: 'launch',
    } as DebugProtocol.Response);

    await expect(outcome).rejects.toThrow('launch failed');
  });

  it('rejectsARequestWhoseSinkThrows_ratherThanLeavingItPending', async () => {
    const protocol: DapProtocol = new DapProtocol((): void => {
      throw new Error('stream closed');
    });

    await expect(protocol.sendRequest('threads')).rejects.toThrow('stream closed');
  });

  it('ignoresAMessageOfAnUnknownType', () => {
    const protocol: DapProtocol = new DapProtocol((): void => undefined);

    expect((): void => protocol.handleMessage({ seq: 1, type: 'other' })).not.toThrow();
  });
});
