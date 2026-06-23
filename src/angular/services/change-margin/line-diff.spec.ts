import { computeLineChanges, LineChangeSet, splitLines } from './line-diff';

/**
 * Sorts a set of line numbers into an array, so set contents can be asserted deterministically.
 * @param values The set to sort.
 * @returns Returns the sorted members.
 */
function sorted(values: ReadonlySet<number>): number[] {
  return [...values].sort((left: number, right: number): number => left - right);
}

describe('computeLineChanges', () => {
  it('noChange_whenContentIsIdentical_returnsEmptySets', () => {
    const lines: string[] = ['a', 'b', 'c'];
    const result: LineChangeSet = computeLineChanges(lines, lines);
    expect(sorted(result.changedLines)).toEqual([]);
    expect(sorted(result.deletionAnchors)).toEqual([]);
  });

  it('insertion_whenLineAddedMidFile_marksOnlyTheInsertedLine', () => {
    const result: LineChangeSet = computeLineChanges(['a', 'b', 'c'], ['a', 'x', 'b', 'c']);
    expect(sorted(result.changedLines)).toEqual([2]);
    expect(sorted(result.deletionAnchors)).toEqual([]);
  });

  it('deletion_whenLineRemovedMidFile_anchorsOnTheSurvivingLineAbove', () => {
    const result: LineChangeSet = computeLineChanges(['a', 'b', 'c'], ['a', 'c']);
    expect(sorted(result.changedLines)).toEqual([]);
    expect(sorted(result.deletionAnchors)).toEqual([1]);
  });

  it('deletion_whenFirstLineRemoved_anchorsAtZero', () => {
    const result: LineChangeSet = computeLineChanges(['a', 'b', 'c'], ['b', 'c']);
    expect(sorted(result.changedLines)).toEqual([]);
    expect(sorted(result.deletionAnchors)).toEqual([0]);
  });

  it('modification_whenOneLineChangedInPlace_marksThatLineWithNoDeletionAnchor', () => {
    const result: LineChangeSet = computeLineChanges(['a', 'b', 'c'], ['a', 'B', 'c']);
    expect(sorted(result.changedLines)).toEqual([2]);
    expect(sorted(result.deletionAnchors)).toEqual([]);
  });

  it('modification_whenManyLinesShrinkToOne_marksTheReplacementWithNoDeletionAnchor', () => {
    const result: LineChangeSet = computeLineChanges(['a', 'b', 'c', 'd'], ['a', 'X', 'd']);
    expect(sorted(result.changedLines)).toEqual([2]);
    expect(sorted(result.deletionAnchors)).toEqual([]);
  });

  it('modification_whenOneLineGrowsToMany_marksAllReplacementLines', () => {
    const result: LineChangeSet = computeLineChanges(['a', 'b', 'd'], ['a', 'X', 'Y', 'Z', 'd']);
    expect(sorted(result.changedLines)).toEqual([2, 3, 4]);
    expect(sorted(result.deletionAnchors)).toEqual([]);
  });

  it('multipleHunks_whenSeveralDisjointChanges_marksEachInModifiedCoordinates', () => {
    const result: LineChangeSet = computeLineChanges(
      ['a', 'b', 'c', 'd', 'e'],
      ['a', 'X', 'c', 'e'],
    );
    // Line 2 is an in-place modification of 'b'; 'd' is a pure deletion anchored on surviving 'c'.
    expect(sorted(result.changedLines)).toEqual([2]);
    expect(sorted(result.deletionAnchors)).toEqual([3]);
  });

  it('insertion_whenBlankLineInsertedNextToAnIdenticalBlank_attributesItToTheEarliestLine', () => {
    // Pressing enter after line 1 inserts a blank above the existing blank. Both blanks are identical,
    // so the change must be attributed to the new (earlier) line 2, not the pre-existing line 3.
    const result: LineChangeSet = computeLineChanges(
      ['Line Text', '', 'Line Text'],
      ['Line Text', '', '', 'Line Text'],
    );
    expect(sorted(result.changedLines)).toEqual([2]);
    expect(sorted(result.deletionAnchors)).toEqual([]);
  });

  it('insertion_whenDuplicateLineInsertedWithTrailingContext_attributesItToTheEarliestLine', () => {
    // Inserting a second 'x' between 'x' and 'y' is ambiguous; it slides up to the earliest line.
    const result: LineChangeSet = computeLineChanges(['x', 'y'], ['x', 'x', 'y']);
    expect(sorted(result.changedLines)).toEqual([1]);
    expect(sorted(result.deletionAnchors)).toEqual([]);
  });

  it('insertion_whenBlankLineInsertedNextToTheTrailingBlankAtEndOfFile_attributesItToTheEarliestLine', () => {
    // File ends with a blank line ('}', then blank). Pressing enter after '}' inserts a blank above
    // the trailing blank; with no context after it, the change must still slide to the new line 2.
    const result: LineChangeSet = computeLineChanges(['}', ''], ['}', '', '']);
    expect(sorted(result.changedLines)).toEqual([2]);
    expect(sorted(result.deletionAnchors)).toEqual([]);
  });

  it('insertion_whenGenuinelyAppendingANewLineAtEndOfFile_marksTheAppendedLine', () => {
    // A genuine append (not next to an identical line) must stay on the appended last line.
    const result: LineChangeSet = computeLineChanges(['a', 'b'], ['a', 'b', 'c']);
    expect(sorted(result.changedLines)).toEqual([3]);
    expect(sorted(result.deletionAnchors)).toEqual([]);
  });

  it('deletion_whenBlankRemovedNextToAnIdenticalBlank_anchorsAtTheEarliestSurvivingLine', () => {
    const result: LineChangeSet = computeLineChanges(
      ['Line Text', '', '', 'Line Text'],
      ['Line Text', '', 'Line Text'],
    );
    expect(sorted(result.changedLines)).toEqual([]);
    expect(sorted(result.deletionAnchors)).toEqual([1]);
  });

  it('lineEndings_whenCrlfComparedToLf_producesIdenticalResults', () => {
    const original: string[] = splitLines('a\r\nb\r\nc');
    const modified: string[] = splitLines('a\nB\nc');
    const result: LineChangeSet = computeLineChanges(original, modified);
    expect(sorted(result.changedLines)).toEqual([2]);
    expect(sorted(result.deletionAnchors)).toEqual([]);
  });
});

describe('splitLines', () => {
  it('split_whenMixedLineEndings_splitsOnCrlfCrAndLf', () => {
    expect(splitLines('a\r\nb\rc\nd')).toEqual(['a', 'b', 'c', 'd']);
  });

  it('split_whenEmptyString_returnsSingleEmptyLine', () => {
    expect(splitLines('')).toEqual(['']);
  });
});
