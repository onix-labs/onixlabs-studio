import { describe, expect, it } from 'vitest';
import { CodeListing, ListingRow } from '@shared/api/code-listing';
import { parseJitDisasm } from './jit-capture';

/**
 * Holds a real capture of one method, as the .NET JIT prints it.
 */
const OUTPUT: string = [
  '15550',
  '; Assembly listing for method P:Add(int,int):int (FullOpts)',
  '; Emitting BLENDED_CODE for generic X64 + VEX on Apple',
  '; FullOpts code',
  '; optimized code',
  '',
  'G_M000_IG01:                ;; offset=0x0000',
  ' ',
  'G_M000_IG02:                ;; offset=0x0000',
  '       mov      eax, edi',
  '       imul     eax, esi',
  '       add      eax, 7',
  ' ',
  'G_M000_IG03:                ;; offset=0x0008',
  '       ret      ',
  ' ',
  '; Total bytes of code 9',
  '',
].join('\n');

describe('parseJitDisasm', (): void => {
  it('finds the compiled method and its instructions', (): void => {
    const listing: CodeListing = parseJitDisasm(OUTPUT, 'dotnet p.dll', 'full-opts');
    expect(listing.sections).toHaveLength(1);
    expect(listing.sections[0].title).toBe('P:Add(int,int):int');
    const mnemonics: readonly string[] = listing.sections[0].rows
      .filter((row: ListingRow): boolean => row.kind === 'instruction')
      .map((row: ListingRow): string => row.mnemonic);
    expect(mnemonics).toEqual(['mov', 'imul', 'add', 'ret']);
  });

  it('gives instruction rows no address, because the JIT reports none', (): void => {
    // An offset is emitted per instruction *group*, never per instruction. Inventing one would be the
    // only way to give these rows an address, which is exactly what the contract refuses to do.
    const listing: CodeListing = parseJitDisasm(OUTPUT, 'dotnet p.dll', 'full-opts');
    const instructions: readonly ListingRow[] = listing.sections[0].rows.filter(
      (row: ListingRow): boolean => row.kind === 'instruction',
    );
    expect(instructions.every((row: ListingRow): boolean => row.address === undefined)).toBe(true);
  });

  it('keeps the group labels, which carry the only offsets available', (): void => {
    const listing: CodeListing = parseJitDisasm(OUTPUT, 'dotnet p.dll', 'full-opts');
    const labels: readonly ListingRow[] = listing.sections[0].rows.filter(
      (row: ListingRow): boolean => row.kind === 'label',
    );
    expect(labels.map((row: ListingRow): string => row.mnemonic)).toEqual([
      'G_M000_IG01',
      'G_M000_IG02',
      'G_M000_IG03',
    ]);
    expect(labels[2].address).toBe(0x8);
  });

  it('reports runtime addressing and the process origin', (): void => {
    const listing: CodeListing = parseJitDisasm(OUTPUT, 'dotnet p.dll', 'full-opts');
    expect(listing.addressing).toBe('runtime-address');
    expect(listing.origin).toEqual({ kind: 'process', command: 'dotnet p.dll', tier: 'FullOpts' });
  });

  it('records the tier the run asked for', (): void => {
    expect(parseJitDisasm(OUTPUT, 'x', 'tier0').origin).toEqual({
      kind: 'process',
      command: 'x',
      tier: 'Tier0',
    });
  });

  it('keeps the header comments and the code size as section notes', (): void => {
    const notes: readonly string[] =
      parseJitDisasm(OUTPUT, 'x', 'full-opts').sections[0].notes ?? [];
    expect(notes).toContain('tier: FullOpts');
    expect(notes).toContain('optimized code');
    expect(notes).toContain('total code size: 9 bytes');
  });

  it('ignores output from the program itself, which shares the stream', (): void => {
    // The captured stdout carries whatever the program printed as well as the JIT's dump; a line
    // outside a method block belongs to the program and must not become an instruction.
    const listing: CodeListing = parseJitDisasm(OUTPUT, 'x', 'full-opts');
    const rows: readonly ListingRow[] = listing.sections[0].rows;
    expect(rows.every((row: ListingRow): boolean => row.mnemonic !== '15550')).toBe(true);
  });

  it('produces no sections when the JIT compiled nothing', (): void => {
    // Which is how the caller tells "ran but matched no method" from "ran and produced output".
    expect(parseJitDisasm('hello world\\n', 'x', 'full-opts').sections).toEqual([]);
  });

  it('separates two compiled methods', (): void => {
    const two: string = `${OUTPUT}; Assembly listing for method P:Mul(int,int):int (Tier0)\nG_M001_IG01:\n       ret\n; Total bytes of code 4\n`;
    expect(parseJitDisasm(two, 'x', 'full-opts').sections).toHaveLength(2);
  });
});
