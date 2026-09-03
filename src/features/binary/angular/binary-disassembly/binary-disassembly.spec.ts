import { TestBed } from '@angular/core/testing';
import { Bridge } from '@shared/api/bridge';
import { BinaryChannel } from '@shared/api/binary-channels';
import { CodeListing } from '@shared/api/code-listing';
import { BinaryDisassembly } from './binary-disassembly';

/**
 * Records the invocations made against the fake bridge, so tests can assert the channel and payload.
 * Reset before each test.
 */
let invocations: { channel: string; args: unknown[] }[] = [];

/**
 * Holds the listing the fake bridge answers every decode with.
 */
const LISTING: CodeListing = {
  language: 'x64',
  addressing: 'file-offset',
  origin: { kind: 'buffer', path: null },
  sections: [
    {
      id: 'native',
      title: '',
      rows: [
        {
          kind: 'instruction',
          address: 100,
          fileOffset: 100,
          bytes: [0x89, 0xd8],
          mnemonic: 'mov',
          operands: 'ax, bx',
        },
      ],
    },
  ],
};

/**
 * Builds a fake transport that records every invocation and answers with {@link LISTING}.
 * @returns Returns the fake bridge.
 */
function fakeBridge(): Bridge {
  return {
    invoke: <T>(channel: string, ...args: unknown[]): Promise<T> => {
      invocations.push({ channel, args });
      return Promise.resolve(LISTING as T);
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

  it('decodeListing_invokesTheDecodeChannelWithTheBytesAndRange', async () => {
    (window as unknown as { bridge: Bridge }).bridge = fakeBridge();
    const client: BinaryDisassembly = TestBed.inject(BinaryDisassembly);

    const listing: CodeListing | null = await client.decodeListing(
      'elf/x64',
      new Uint8Array([0x89, 0xd8]),
      100,
      512,
      '/ws/a.out',
    );

    expect(listing).toEqual(LISTING);
    expect(invocations).toHaveLength(1);
    expect(invocations[0].channel).toBe(BinaryChannel.DecodeListing);
    // The bytes travel, not the path: that is what keeps unsaved edits reflected.
    expect(invocations[0].args[0]).toBe('elf/x64');
    expect(invocations[0].args[1]).toEqual(new Uint8Array([0x89, 0xd8]));
    expect(invocations[0].args[2]).toBe(100);
  });

  it('decoderInfo_invokesTheInfoChannel', async () => {
    (window as unknown as { bridge: Bridge }).bridge = fakeBridge();
    const client: BinaryDisassembly = TestBed.inject(BinaryDisassembly);

    await client.decoderInfo('jvm');

    expect(invocations[0].channel).toBe(BinaryChannel.DecoderInfo);
    expect(invocations[0].args[0]).toBe('jvm');
  });

  it('withoutABridge_resolvesToNothingRatherThanThrowing', async () => {
    // Outside Electron there is no transport; a view must still render.
    const client: BinaryDisassembly = TestBed.inject(BinaryDisassembly);

    expect(await client.decodeListing('elf/x64', new Uint8Array([0x90]), 0)).toBeNull();
    expect(await client.decoderInfo('elf/x64')).toBeNull();
    expect(invocations).toHaveLength(0);
  });
});
