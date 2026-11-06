import { describe, expect, it } from 'vitest';

import { applyReviewEdits, changedRange, isOffsetReplaced, mapOffset } from './review-edits';
import { ReviewEdit } from './review-types';

describe('review edits', () => {
  it('applyReviewEdits_whenGivenInAnyOrder_appliesEachAgainstTheOriginalOffsets', () => {
    const edits: readonly ReviewEdit[] = [
      { start: 0, end: 3, replacement: 'one' },
      { start: 8, end: 11, replacement: 'three!' },
      { start: 4, end: 7, replacement: 'second' },
    ];

    expect(applyReviewEdits('aaa bbb ccc', edits)).toBe('one second three!');
  });

  it('changedRange_whenIdentical_isNull', () => {
    expect(changedRange('same', 'same')).toBeNull();
  });

  it('changedRange_whenTextIsInsertedAtTheStart_isAnInsertionThere', () => {
    expect(changedRange('world', 'hello world')).toEqual({
      start: 0,
      end: 0,
      replacement: 'hello ',
    });
  });

  it('changedRange_whenAWordChanges_coversOnlyThatWord', () => {
    expect(changedRange('the cat sat', 'the dog sat')).toEqual({
      start: 4,
      end: 7,
      replacement: 'dog',
    });
  });

  it('changedRange_whenARepeatedLetterIsRemoved_neverOverlapsTheTwoEnds', () => {
    expect(changedRange('aaa', 'aa')).toEqual({ start: 2, end: 3, replacement: '' });
  });

  it('mapOffset_whenBeforeAnEdit_staysPut', () => {
    expect(mapOffset(2, [{ start: 5, end: 6, replacement: 'long' }])).toBe(2);
  });

  it('mapOffset_whenAfterEdits_shiftsByEachOfThem', () => {
    const edits: readonly ReviewEdit[] = [
      { start: 8, end: 9, replacement: '' },
      { start: 0, end: 1, replacement: 'abc' },
    ];

    expect(mapOffset(10, edits)).toBe(11);
  });

  it('mapOffset_whenInsideAnEdit_landsOnItsReplacement', () => {
    const edits: readonly ReviewEdit[] = [
      { start: 0, end: 0, replacement: 'xx' },
      { start: 4, end: 8, replacement: 'y' },
    ];

    expect(mapOffset(6, edits)).toBe(6);
  });

  it('isOffsetReplaced_isTrueOnlyInsideTheReplacedRange', () => {
    const edits: readonly ReviewEdit[] = [{ start: 4, end: 8, replacement: 'y' }];

    expect(isOffsetReplaced(3, edits)).toBe(false);
    expect(isOffsetReplaced(4, edits)).toBe(true);
    expect(isOffsetReplaced(7, edits)).toBe(true);
    expect(isOffsetReplaced(8, edits)).toBe(false);
  });
});
