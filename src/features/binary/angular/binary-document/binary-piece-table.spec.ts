import { Piece, PieceRun, PieceTable, PieceTableSnapshot } from './binary-piece-table';

/**
 * Resolves a table's logical bytes against a stand-in original file, so tests can assert the whole
 * logical sequence a table represents.
 * @param table The piece table.
 * @param original The original file's bytes.
 * @returns Returns the logical bytes in order.
 */
function read(table: PieceTable, original: readonly number[]): number[] {
  const bytes: number[] = [];
  for (let offset: number = 0; offset < table.length(); offset += 1) {
    const location: { original: number } | { value: number } | null = table.locate(offset);
    bytes.push(
      location === null ? -1 : 'value' in location ? location.value : original[location.original],
    );
  }
  return bytes;
}

describe('PieceTable', () => {
  const ORIGINAL: number[] = [10, 11, 12, 13, 14];
  let table: PieceTable;

  beforeEach(() => {
    table = new PieceTable();
    table.init(ORIGINAL.length);
  });

  it('init_representsTheWholeOriginalFile', () => {
    expect(table.length()).toBe(5);
    expect(read(table, ORIGINAL)).toEqual([10, 11, 12, 13, 14]);
    expect(table.isPristine()).toBe(true);
    expect(table.isStructural()).toBe(false);
  });

  it('replace_overwriteSwapsAByteWithoutChangingLength', () => {
    table.replace(2, 1, [0xff]);
    expect(table.length()).toBe(5);
    expect(read(table, ORIGINAL)).toEqual([10, 11, 0xff, 13, 14]);
    expect(table.isStructural()).toBe(false);
    expect(table.isPristine()).toBe(false);
  });

  it('replace_insertGrowsTheSequenceAndIsStructural', () => {
    table.replace(2, 0, [0xaa, 0xbb]);
    expect(table.length()).toBe(7);
    expect(read(table, ORIGINAL)).toEqual([10, 11, 0xaa, 0xbb, 12, 13, 14]);
    expect(table.isStructural()).toBe(true);
  });

  it('replace_deleteShrinksTheSequenceAndIsStructural', () => {
    table.replace(1, 2, []);
    expect(table.length()).toBe(3);
    expect(read(table, ORIGINAL)).toEqual([10, 13, 14]);
    expect(table.isStructural()).toBe(true);
  });

  it('replace_atTheEndAppends', () => {
    table.replace(5, 0, [0x99]);
    expect(read(table, ORIGINAL)).toEqual([10, 11, 12, 13, 14, 0x99]);
  });

  it('overwritePatches_coalescesConsecutiveOverwrites', () => {
    table.replace(1, 1, [0xa1]);
    table.replace(2, 1, [0xa2]);
    table.replace(4, 1, [0xa4]);
    const runs: PieceRun[] = table.overwritePatches();
    expect(runs).toEqual([
      { offset: 1, bytes: [0xa1, 0xa2] },
      { offset: 4, bytes: [0xa4] },
    ]);
  });

  it('snapshotAndRestore_undoAnEdit', () => {
    const before: PieceTableSnapshot = table.snapshot();
    table.replace(0, 2, [0x01]);
    expect(read(table, ORIGINAL)).toEqual([0x01, 12, 13, 14]);
    table.restore(before);
    expect(read(table, ORIGINAL)).toEqual([10, 11, 12, 13, 14]);
    expect(table.isPristine()).toBe(true);
  });

  it('spans_andAddedBytes_describeAStructuralSave', () => {
    table.replace(2, 0, [0x77]);
    const spans: readonly Piece[] = table.spans();
    expect(spans).toEqual([
      { source: 'original', start: 0, length: 2 },
      { source: 'added', start: 0, length: 1 },
      { source: 'original', start: 2, length: 3 },
    ]);
    expect(Array.from(table.addedBytes())).toEqual([0x77]);
  });

  it('reset_returnsToACleanFileOfANewSize', () => {
    table.replace(0, 0, [1, 2, 3]);
    table.reset(8);
    expect(table.length()).toBe(8);
    expect(table.isPristine()).toBe(true);
    expect(table.isStructural()).toBe(false);
  });
});
