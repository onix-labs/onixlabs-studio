import { describe, expect, it } from 'vitest';
import { DecodedInstruction } from './binary-channels';
import {
  CodeListing,
  listingFromInstructions,
  listingRowCount,
  ListingRow,
  ListingSection,
  rowAtFileOffset,
} from './code-listing';

/**
 * Builds a decoded instruction for the tests.
 * @param startOffset The file offset.
 * @param mnemonic The mnemonic.
 * @param byteLength The instruction length.
 * @returns Returns the instruction.
 */
function instruction(
  startOffset: number,
  mnemonic: string,
  byteLength: number = 1,
): DecodedInstruction {
  return {
    startOffset,
    byteLength,
    mnemonic,
    operands: '',
    raw: new Array<number>(byteLength).fill(0x90),
  };
}

describe('listingFromInstructions', (): void => {
  it('wraps flat native instructions as a single file-offset section', (): void => {
    const listing: CodeListing = listingFromInstructions(
      [instruction(0x10, 'push'), instruction(0x11, 'ret')],
      'x64',
      '/tmp/a.out',
    );
    expect(listing.addressing).toBe('file-offset');
    expect(listing.sections).toHaveLength(1);
    expect(listing.origin).toEqual({ kind: 'buffer', path: '/tmp/a.out' });
    expect(listing.sections[0].rows.map((row): string => row.mnemonic)).toEqual(['push', 'ret']);
  });

  it('sets address and fileOffset alike for native code, where they are the same thing', (): void => {
    const listing: CodeListing = listingFromInstructions([instruction(0x20, 'nop')], 'x64', null);
    expect(listing.sections[0].rows[0].address).toBe(0x20);
    expect(listing.sections[0].rows[0].fileOffset).toBe(0x20);
  });
});

describe('rowAtFileOffset', (): void => {
  /**
   * Builds a two-section, method-relative listing where both methods start at address zero — the
   * situation that makes resolving on `address` wrong.
   */
  const methodRelative: CodeListing = {
    language: 'JVM bytecode',
    addressing: 'method-relative',
    origin: { kind: 'buffer', path: null },
    sections: [
      {
        id: 'first',
        title: 'int first()',
        rows: [
          { address: 0, fileOffset: 100, mnemonic: 'iload_0', operands: '', bytes: [0x1a] },
          { address: 1, fileOffset: 101, mnemonic: 'ireturn', operands: '', bytes: [0xac] },
        ],
      },
      {
        id: 'second',
        title: 'int second()',
        rows: [
          { address: 0, fileOffset: 200, mnemonic: 'iconst_1', operands: '', bytes: [0x04] },
          { address: 1, fileOffset: 201, mnemonic: 'ireturn', operands: '', bytes: [0xac] },
        ],
      },
    ],
  };

  it('resolves into the correct section even though both sections address from zero', (): void => {
    const found: { readonly section: ListingSection; readonly row: ListingRow } | null =
      rowAtFileOffset(methodRelative, 200);
    expect(found?.section.id).toBe('second');
    expect(found?.row.mnemonic).toBe('iconst_1');
  });

  it('resolves a row from an offset inside a multi-byte instruction', (): void => {
    const listing: CodeListing = listingFromInstructions(
      [instruction(0x10, 'call', 5)],
      'x64',
      null,
    );
    expect(rowAtFileOffset(listing, 0x13)?.row.mnemonic).toBe('call');
  });

  it('returns null for an offset no row covers', (): void => {
    expect(rowAtFileOffset(methodRelative, 150)).toBeNull();
  });

  it('never matches rows with no file offset, because those bytes are in no file', (): void => {
    // JIT rows: produced by a running process, so there is nothing on disk to have been clicked.
    const jit: CodeListing = {
      language: 'x64 (JIT-generated)',
      addressing: 'runtime-address',
      origin: { kind: 'process', command: 'dotnet app.dll', tier: 'FullOpts' },
      sections: [
        {
          id: 'method',
          title: 'P:Add(int,int)',
          rows: [
            { kind: 'label', address: 0, mnemonic: 'G_M000_IG01', operands: '' },
            { kind: 'instruction', mnemonic: 'mov', operands: 'eax, edi' },
          ],
        },
      ],
    };
    expect(rowAtFileOffset(jit, 0)).toBeNull();
  });
});

describe('listingRowCount', (): void => {
  it('counts rows across every section', (): void => {
    const listing: CodeListing = {
      language: 'test',
      addressing: 'file-offset',
      origin: { kind: 'buffer', path: null },
      sections: [
        { id: 'a', title: 'a', rows: [{ mnemonic: 'x', operands: '' }] },
        {
          id: 'b',
          title: 'b',
          rows: [
            { mnemonic: 'y', operands: '' },
            { mnemonic: 'z', operands: '' },
          ],
        },
      ],
    };
    expect(listingRowCount(listing)).toBe(3);
  });

  it('counts an empty listing as no rows', (): void => {
    expect(
      listingRowCount({
        language: 'test',
        addressing: 'file-offset',
        origin: { kind: 'buffer', path: null },
        sections: [],
      }),
    ).toBe(0);
  });
});
