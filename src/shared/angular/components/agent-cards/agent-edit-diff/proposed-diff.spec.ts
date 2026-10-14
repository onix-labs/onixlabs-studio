import {
  applyReplacements,
  fragmentDiff,
  ProposedDiff,
  proposedDiff,
  ProposedDiffLine,
} from './proposed-diff';

describe('proposedDiff', () => {
  it('countsAndNumbersTheLines_beforeAndAfter', () => {
    const diff: ProposedDiff = proposedDiff('a.ts', 'one\ntwo\nthree\n', 'one\n2\nthree\n');

    expect(diff.additions).toBe(1);
    expect(diff.deletions).toBe(1);
    expect(diff.newFile).toBe(false);
    expect(
      diff.hunks[0].lines.map(
        (line: ProposedDiffLine): string =>
          `${line.kind}:${line.oldLine ?? '-'}:${line.newLine ?? '-'}:${line.text}`,
      ),
    ).toEqual(['context:1:1:one', 'remove:2:-:two', 'add:-:2:2', 'context:3:3:three']);
  });

  it('marksANewFile_andAddsEveryLine', () => {
    const diff: ProposedDiff = proposedDiff('new.ts', null, 'a\nb\n');

    expect(diff.newFile).toBe(true);
    expect(diff.additions).toBe(2);
    expect(diff.deletions).toBe(0);
  });

  it('leavesOutWhatIsTooLongToShow_butCountsItAll', () => {
    const lines: string = Array.from(
      { length: 1000 },
      (_: unknown, i: number): string => `${i}`,
    ).join('\n');

    const diff: ProposedDiff = proposedDiff('big.ts', null, lines);

    expect(diff.truncated).toBe(true);
    expect(diff.additions).toBe(1000);
    expect(
      diff.hunks.reduce(
        (shown: number, hunk: { lines: readonly unknown[] }): number => shown + hunk.lines.length,
        0,
      ),
    ).toBe(400);
  });
});

describe('applyReplacements', () => {
  it('replacesTheFirstOccurrence_orEveryOneWhenAsked', () => {
    expect(applyReplacements('a a', [{ oldText: 'a', newText: 'b' }])).toBe('b a');
    expect(applyReplacements('a a', [{ oldText: 'a', newText: 'b', replaceAll: true }])).toBe(
      'b b',
    );
  });

  it('takesTheNewTextLiterally_evenWithReplacementPatternsInIt', () => {
    // `$&` means "the match" to String.replace; an edit's text is never a pattern.
    expect(applyReplacements('price', [{ oldText: 'price', newText: '$&5' }])).toBe('$&5');
  });

  it('setsTheWholeFile_forAnEmptySearch', () => {
    expect(applyReplacements('', [{ oldText: '', newText: 'all' }])).toBe('all');
  });

  it('saysSo_whenTheTextIsNoLongerInTheFile', () => {
    expect(applyReplacements('changed', [{ oldText: 'original', newText: 'x' }])).toBeNull();
  });
});

describe('fragmentDiff', () => {
  it('showsTheReplacedTextAlone_andSaysItIsOnlyThat', () => {
    const diff: ProposedDiff = fragmentDiff('a.ts', [{ oldText: 'old', newText: 'new' }]);

    expect(diff.fragmentsOnly).toBe(true);
    expect(diff.additions).toBe(1);
    expect(diff.deletions).toBe(1);
  });
});
