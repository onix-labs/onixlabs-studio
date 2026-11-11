import { describe, expect, it } from 'vitest';
import { splitBatches, SqlServerBatch } from './sqlserver-batches';

/**
 * Reduces batches to their text, line and repeat count.
 * @param batches The batches.
 * @returns Returns them as tuples.
 */
function shape(batches: readonly SqlServerBatch[]): readonly [string, number, number][] {
  return batches.map((batch: SqlServerBatch): [string, number, number] => [
    batch.text,
    batch.line,
    batch.repeat,
  ]);
}

describe('splitBatches', () => {
  it('splitsAtEachGoLine_inAnyCase_withTheLineEachBatchStartsOn', () => {
    expect(shape(splitBatches('select 1\ngo\nselect 2\nGo\n\nselect 3'))).toEqual([
      ['select 1', 1, 1],
      ['select 2', 3, 1],
      ['\nselect 3', 5, 1],
    ]);
  });

  it('readsACountAfterGo_andAComment', () => {
    expect(shape(splitBatches('insert t default values\nGO 3 -- three rows'))).toEqual([
      ['insert t default values', 1, 3],
    ]);
  });

  it('boundsTheCount_soATypoCannotRunABatchAMillionTimes', () => {
    expect(splitBatches('select 1\nGO 1000000')[0]?.repeat).toBe(1000);
  });

  it('ignoresGo_insideAStringABracketedNameOrABlockComment', () => {
    const script: string = [
      "select 'a",
      'go',
      "b' as text",
      'select 1 as [x',
      'go',
      ']',
      '/* outer /* nested',
      'go',
      '*/ still a comment',
      'go */',
      'select 2',
    ].join('\n');

    expect(splitBatches(script)).toHaveLength(1);
  });

  it('isNotFooledByADoubledQuote_orALineComment', () => {
    expect(splitBatches("select 'it''s'\ngo\nselect 2 -- it's\ngo\nselect 3")).toHaveLength(3);
  });

  it('takesGoOnlyWhenItIsAloneOnItsLine', () => {
    expect(splitBatches('select 1 go\nselect gone\ngoto_label:')).toHaveLength(1);
  });

  it('dropsABatchOfOnlyWhitespaceAndComments', () => {
    expect(shape(splitBatches('GO\n-- nothing\n/* here */\nGO\nselect 1\nGO'))).toEqual([
      ['select 1', 5, 1],
    ]);
  });

  it('countsFromTheFirstLineItIsGiven', () => {
    expect(splitBatches('select 1\nGO\nselect 2', 10).map((b) => b.line)).toEqual([10, 12]);
  });
});
