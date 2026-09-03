import { describe, expect, it } from 'vitest';
import { CodeListing, listingFromInstructions } from '@shared/api/code-listing';
import { DecodedInstruction } from '@shared/api/binary-channels';
import {
  buildContent,
  DisasmContent,
  lineForFileOffset,
  lineForSourceLine,
  linesForRange,
  renderAddress,
} from '@shared/angular/services/decoders/listing-content';

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

/**
 * Builds a two-method JVM listing, where both methods address from zero.
 */
const jvmListing: CodeListing = {
  language: 'JVM bytecode (class 65.0)',
  addressing: 'method-relative',
  origin: { kind: 'buffer', path: '/tmp/A.class' },
  sections: [
    {
      id: 'first',
      title: 'static int first()',
      notes: ['max_stack=1, max_locals=0'],
      rows: [
        { address: 0, fileOffset: 100, mnemonic: 'iconst_0', operands: '', bytes: [0x03] },
        { address: 1, fileOffset: 101, mnemonic: 'ireturn', operands: '', bytes: [0xac] },
      ],
    },
    {
      id: 'second',
      title: 'static int second()',
      rows: [
        { address: 0, fileOffset: 200, mnemonic: 'iconst_1', operands: '', bytes: [0x04] },
        { address: 1, fileOffset: 201, mnemonic: 'ireturn', operands: '', bytes: [0xac] },
      ],
    },
  ],
};

describe('buildContent', (): void => {
  it('returns empty content for a null listing', (): void => {
    expect(buildContent(null)).toEqual({ text: '', lines: [] });
  });

  it('renders section headings and notes, and maps them to no row', (): void => {
    const content: DisasmContent = buildContent(jvmListing);
    const lines: readonly string[] = content.text.split('\n');
    expect(lines[0]).toBe('static int first()');
    expect(lines[1]).toBe('  ; max_stack=1, max_locals=0');
    // A heading and a note occupy lines but show no row, so the map is sparse there.
    expect(content.lines[0]).toBeNull();
    expect(content.lines[1]).toBeNull();
    expect(content.lines[2]).not.toBeNull();
  });

  it('keeps the line map aligned with the rendered text', (): void => {
    const content: DisasmContent = buildContent(jvmListing);
    expect(content.lines).toHaveLength(content.text.split('\n').length);
  });

  it('separates sections with a blank line that maps to no row', (): void => {
    const content: DisasmContent = buildContent(jvmListing);
    const lines: readonly string[] = content.text.split('\n');
    const blank: number = lines.indexOf('');
    expect(blank).toBeGreaterThan(0);
    expect(content.lines[blank]).toBeNull();
  });

  it('renders JVM addresses in decimal, as javap does', (): void => {
    expect(buildContent(jvmListing).text).toContain('     0  iconst_0');
  });

  it('renders native addresses in hex', (): void => {
    const listing: CodeListing = listingFromInstructions(
      [instruction(0x1f, 'ret')],
      'x64',
      '/tmp/a.out',
    );
    expect(buildContent(listing).text).toContain('0000001F  ret');
  });

  it('shows no heading for a single-section listing, which is what native disassembly produces', (): void => {
    // The panel header already says "Assembly" and the status strip names the format; a lone heading
    // would state the same thing a third time, and would change what users see today.
    const listing: CodeListing = listingFromInstructions([instruction(0, 'nop')], 'x64', null);
    const content: DisasmContent = buildContent(listing);
    expect(content.text).toBe('00000000  nop');
    expect(content.lines).toHaveLength(1);
  });

  it('renders a row with no address without inventing one', (): void => {
    // JIT instruction rows genuinely have no address — the JIT reports one per instruction group.
    const jit: CodeListing = {
      language: 'x64 (JIT-generated)',
      addressing: 'runtime-address',
      origin: { kind: 'process', command: 'dotnet app.dll', tier: 'FullOpts' },
      sections: [
        {
          id: 'm',
          title: 'P:Add(int,int)',
          rows: [
            { kind: 'label', address: 0, mnemonic: 'G_M000_IG02', operands: '' },
            { kind: 'instruction', mnemonic: 'mov', operands: 'eax, edi' },
          ],
        },
      ],
    };
    const content: DisasmContent = buildContent(jit);
    expect(content.text).toContain('G_M000_IG02:');
    expect(content.text).toContain('mov eax, edi');
    expect(content.text).not.toContain('00000000  mov');
  });
});

describe('lineForFileOffset', (): void => {
  it('resolves into the correct section although both sections address from zero', (): void => {
    // Resolving on the row address would land in the first section every time.
    const content: DisasmContent = buildContent(jvmListing);
    const line: number | null = lineForFileOffset(content, 200);
    expect(line).not.toBeNull();
    expect(content.text.split('\n')[(line ?? 1) - 1]).toContain('iconst_1');
  });

  it('resolves an offset inside a multi-byte instruction', (): void => {
    const listing: CodeListing = listingFromInstructions(
      [instruction(0x10, 'call', 5)],
      'x64',
      null,
    );
    const content: DisasmContent = buildContent(listing);
    expect(lineForFileOffset(content, 0x13)).toBe(lineForFileOffset(content, 0x10));
  });

  it('returns null for an offset no row covers', (): void => {
    expect(lineForFileOffset(buildContent(jvmListing), 150)).toBeNull();
  });
});

describe('linesForRange', (): void => {
  it('returns every line whose bytes overlap the range', (): void => {
    const content: DisasmContent = buildContent(jvmListing);
    expect(linesForRange(content, 100, 102)).toHaveLength(2);
  });

  it('returns nothing for a range no row covers', (): void => {
    expect(linesForRange(buildContent(jvmListing), 150, 160)).toEqual([]);
  });

  it('never matches heading lines, which show no row', (): void => {
    const content: DisasmContent = buildContent(jvmListing);
    // Spanning the whole file must still only select rows, never the headings between them.
    const matched: readonly number[] = linesForRange(content, 0, 1000);
    for (const line of matched) {
      expect(content.lines[line - 1]).not.toBeNull();
    }
    expect(matched).toHaveLength(4);
  });
});

describe('renderAddress', (): void => {
  it('pads native addresses to eight hex digits', (): void => {
    const listing: CodeListing = listingFromInstructions([instruction(0, 'nop')], 'x64', null);
    expect(renderAddress(0x2a, listing)).toBe('0000002A');
  });

  it('renders method-relative JVM addresses in decimal', (): void => {
    expect(renderAddress(42, jvmListing).trim()).toBe('42');
  });

  it('renders method-relative IL addresses in hex, unlike JVM', (): void => {
    // IL is conventionally read as `IL_0007`; only javap uses decimal.
    const il: CodeListing = { ...jvmListing, language: '.NET IL' };
    expect(renderAddress(7, il)).toBe('00000007');
  });
});

describe('source-line gutter', (): void => {
  /**
   * Builds a listing whose rows carry source lines.
   */
  const withLines: CodeListing = {
    language: '.NET IL',
    addressing: 'method-relative',
    origin: { kind: 'buffer', path: '/tmp/a.dll' },
    sections: [
      {
        id: 'm',
        title: 'Shapes.Loop',
        notes: ['source lines from the portable PDB'],
        rows: [
          { address: 0, fileOffset: 100, mnemonic: 'nop', operands: '', sourceLine: 14 },
          { address: 1, fileOffset: 101, mnemonic: 'ldc.i4.0', operands: '', sourceLine: 15 },
          { address: 2, fileOffset: 102, mnemonic: 'ret', operands: '' },
        ],
      },
      { id: 'other', title: 'Shapes.Text', rows: [] },
    ],
  };

  it('renders the line beside each row that has one', (): void => {
    const text: string = buildContent(withLines).text;
    expect(text).toContain('   14 ');
    expect(text).toContain('   15 ');
  });

  it('keeps the column width for a row with no line, so addresses stay aligned', (): void => {
    // A ragged left edge reads as corruption in a listing.
    const lines: readonly string[] = buildContent(withLines).text.split('\n');
    const withLine: string | undefined = lines.find((line: string): boolean =>
      line.includes('nop'),
    );
    const without: string | undefined = lines.find((line: string): boolean => line.includes('ret'));
    expect(withLine?.indexOf('0000')).toBe(without?.indexOf('0000'));
  });

  it('shows no gutter at all when the listing carries no source lines', (): void => {
    // A decoder with no source mapping must not pay for an empty column on every row.
    const listing: CodeListing = listingFromInstructions([instruction(0, 'nop')], 'x64', null);
    expect(buildContent(listing).text).toBe('00000000  nop');
  });

  it('keeps the line map aligned once a gutter is present', (): void => {
    const content: DisasmContent = buildContent(withLines);
    expect(content.lines).toHaveLength(content.text.split('\n').length);
  });
});

describe('lineForSourceLine', (): void => {
  /**
   * A listing whose rows carry source lines with a gap: nothing was generated from line 16.
   */
  const mapped: CodeListing = {
    language: '.NET IL',
    addressing: 'method-relative',
    origin: { kind: 'buffer', path: '/tmp/a.dll' },
    sections: [
      {
        id: 'm',
        title: 'Shapes.Loop',
        rows: [
          { address: 0, fileOffset: 10, mnemonic: 'nop', operands: '', sourceLine: 14 },
          { address: 1, fileOffset: 11, mnemonic: 'ldc.i4.0', operands: '', sourceLine: 15 },
          { address: 2, fileOffset: 12, mnemonic: 'stloc.0', operands: '', sourceLine: 15 },
          { address: 3, fileOffset: 13, mnemonic: 'ret', operands: '', sourceLine: 18 },
        ],
      },
    ],
  };

  it('finds the first row generated from a line', (): void => {
    const content: DisasmContent = buildContent(mapped);
    const line: number | null = lineForSourceLine(content, 15);
    expect(line).not.toBeNull();
    expect(content.text.split('\n')[(line ?? 1) - 1]).toContain('ldc.i4.0');
  });

  it('falls forward to the next generated line when nothing came from the one asked for', (): void => {
    // A blank line or a comment produces no instructions; scrolling to the next thing that did is
    // more useful than not moving at all.
    const content: DisasmContent = buildContent(mapped);
    const line: number | null = lineForSourceLine(content, 16);
    expect(content.text.split('\n')[(line ?? 1) - 1]).toContain('ret');
  });

  it('returns null past the last generated line', (): void => {
    expect(lineForSourceLine(buildContent(mapped), 99)).toBeNull();
  });

  it('returns null for a listing that carries no source lines', (): void => {
    const listing: CodeListing = listingFromInstructions([instruction(0, 'nop')], 'x64', null);
    expect(lineForSourceLine(buildContent(listing), 1)).toBeNull();
  });
});
