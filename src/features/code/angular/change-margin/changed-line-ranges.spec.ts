import { describe, expect, it } from 'vitest';
import { changedLineRanges } from './changed-line-ranges';

describe('changedLineRanges', () => {
  it('finds nothing when the text is unchanged', () => {
    expect(changedLineRanges('a\nb', 'a\nb')).toEqual([]);
  });

  it('joins neighbouring lines, last run first', () => {
    expect(changedLineRanges('a\nb\nc\nd\ne', 'x\nb\ny\nz\ne')).toEqual([
      { first: 3, last: 4 },
      { first: 1, last: 1 },
    ]);
  });

  it('has nothing to format where lines were only removed', () => {
    expect(changedLineRanges('a\nb\nc', 'a\nc')).toEqual([]);
  });
});
