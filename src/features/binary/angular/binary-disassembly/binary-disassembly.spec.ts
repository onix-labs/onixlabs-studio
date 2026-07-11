import { TestBed } from '@angular/core/testing';
import { Bridge } from '@shared/api/bridge';
import { BinaryChannel, DecodedInstruction } from '@shared/api/binary-channels';
import { BinaryDisassembly } from './binary-disassembly';

/**
 * Records the invocations made against the fake bridge, so tests can assert the channel and payload.
 * Reset before each test.
 */
let invocations: { channel: string; args: unknown[] }[] = [];

/**
 * Holds the instructions the fake bridge decodes for every request.
 */
const INSTRUCTIONS: readonly DecodedInstruction[] = [
  { startOffset: 100, byteLength: 2, mnemonic: 'mov', operands: 'ax, bx', raw: [0x89, 0xd8] },
];

/**
 * Builds a fake transport that records every invocation and answers with {@link INSTRUCTIONS}.
 * @returns Returns the fake bridge.
 */
function fakeBridge(): Bridge {
  return {
    invoke: <T>(channel: string, ...args: unknown[]): Promise<T> => {
      invocations.push({ channel, args });
      return Promise.resolve(INSTRUCTIONS as T);
    },
    send: (): void => undefined,
    on: (): (() => void) => (): void => undefined,
  };
}

describe('BinaryDisassembly', () => {
  beforeEach(() => {
    invocations = [];
  });

  afterEach(() => {
    delete (window as unknown as { bridge?: unknown }).bridge;
  });

  it('disassemble_invokesTheBinaryChannelWithTheBufferAndRange', async () => {
    (window as unknown as { bridge: Bridge }).bridge = fakeBridge();
    TestBed.configureTestingModule({});
    const service: BinaryDisassembly = TestBed.inject(BinaryDisassembly);
    const bytes: Uint8Array = new Uint8Array([0x89, 0xd8]);

    const result: readonly DecodedInstruction[] = await service.disassemble(
      bytes,
      96,
      100,
      102,
      'x64',
    );

    expect(result).toEqual(INSTRUCTIONS);
    expect(invocations).toEqual([
      { channel: BinaryChannel.Disassemble, args: [bytes, 96, 100, 102, 'x64'] },
    ]);
  });

  it('disassemble_withoutABridge_resolvesToAnEmptyList', async () => {
    TestBed.configureTestingModule({});
    const service: BinaryDisassembly = TestBed.inject(BinaryDisassembly);

    const result: readonly DecodedInstruction[] = await service.disassemble(
      new Uint8Array([0x90]),
      0,
      0,
      1,
      'x86',
    );

    expect(result).toEqual([]);
    expect(invocations).toEqual([]);
  });
});
