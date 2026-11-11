import { describe, expect, it } from 'vitest';
import {
  choiceForSide,
  ConflictBlock,
  conflictSides,
  conflictsLeftMessage,
  countConflicts,
  describeOperation,
  keepSideLabel,
  parseConflicts,
  resolveConflictLines,
  resolvedProgress,
} from './conflict-resolution';

/**
 * One conflict as git writes it.
 */
const CONFLICT: string = ['<<<<<<< HEAD', 'ours', '=======', 'theirs', '>>>>>>> feature'].join(
  '\n',
);

describe('countConflicts', () => {
  it('countsEachWholeBlock', () => {
    expect(countConflicts(`a\n${CONFLICT}\nb\n${CONFLICT}\n`)).toBe(2);
  });

  it('countsADiff3Block_whoseBaseSectionSitsBeforeTheDivider', () => {
    const diff3: string = [
      '<<<<<<< HEAD',
      'ours',
      '||||||| base',
      'base',
      '=======',
      'theirs',
      '>>>>>>> feature',
    ].join('\n');

    expect(countConflicts(diff3)).toBe(1);
  });

  it('countsNothing_inProseThatOnlyHasADivider', () => {
    // A markdown heading underlined with equals signs is not a conflict.
    expect(countConflicts('Title\n=======\n\nText.\n')).toBe(0);
  });

  it('countsNothing_forAnOpenerThatIsNeverClosed', () => {
    expect(countConflicts('<<<<<<< HEAD\nours\n=======\ntheirs\n')).toBe(0);
  });

  it('countsNothing_forMarkersThatAreNotAtTheStartOfTheirLine', () => {
    expect(countConflicts('  <<<<<<< HEAD\n  =======\n  >>>>>>> x\n')).toBe(0);
  });

  it('readsWindowsLineEndings', () => {
    expect(countConflicts(CONFLICT.replace(/\n/g, '\r\n'))).toBe(1);
  });
});

describe('conflictSides', () => {
  it('inAMerge_namesTheCheckedOutBranchYours_andTheMergedOneTheirs', () => {
    expect(conflictSides({ kind: 'merge', target: 'feature/login' }, 'main')).toEqual({
      yours: 'main',
      theirs: 'feature/login',
    });
  });

  it('inARebase_namesTheBranchBeingReplayedYours_andItsUpstreamTheirs', () => {
    // Git swaps ours and theirs in a rebase; the user's own work is still "yours".
    expect(
      conflictSides({ kind: 'rebase', branch: 'feature/login', target: 'main' }, null),
    ).toEqual({ yours: 'feature/login', theirs: 'main' });
  });

  it('inACherryPick_namesOnlyTheCheckedOutBranch', () => {
    expect(conflictSides({ kind: 'cherry-pick' }, 'main')).toEqual({ yours: 'main', theirs: null });
  });
});

describe('keepSideLabel', () => {
  it('namesTheBranch_withItsRole', () => {
    const sides: { yours: string; theirs: string } = { yours: 'main', theirs: 'feature/login' };

    expect(keepSideLabel('yours', sides)).toBe('Keep main (Yours)');
    expect(keepSideLabel('theirs', sides)).toBe('Keep feature/login (Theirs)');
  });

  it('fallsBackToTheRoleAlone_whenNothingNamesTheSide', () => {
    expect(keepSideLabel('theirs', { yours: 'main', theirs: null })).toBe('Keep Theirs');
  });
});

describe('describeOperation', () => {
  it.each([
    [{ kind: 'merge', target: 'feature/x' } as const, 'main', 'Merging feature/x into main'],
    [{ kind: 'merge' } as const, 'main', 'Merging into main'],
    [
      { kind: 'rebase', branch: 'feature/x', target: 'main', step: 3, total: 7 } as const,
      null,
      'Rebasing feature/x onto main — commit 3 of 7',
    ],
    [{ kind: 'rebase', target: 'main' } as const, null, 'Rebasing onto main'],
    [
      { kind: 'squash-merge', target: 'feature/x' } as const,
      'main',
      'Squash merging feature/x into main',
    ],
    [{ kind: 'cherry-pick' } as const, 'main', 'Cherry-picking onto main'],
    [{ kind: 'revert' } as const, null, 'Reverting'],
    [{ kind: null } as const, 'main', ''],
  ])('describes %o on %s as %s', (operation, branch: string | null, expected: string) => {
    expect(describeOperation(operation, branch)).toBe(expected);
  });
});

describe('resolvedProgress', () => {
  it('saysHowManyFilesOfHowManyAreResolved', () => {
    expect(resolvedProgress(2, 5)).toBe('2 of 5 files resolved');
    expect(resolvedProgress(0, 1)).toBe('0 of 1 file resolved');
  });

  it('saysNothing_beforeAnyFileHasBeenSeenConflicted', () => {
    expect(resolvedProgress(0, 0)).toBeNull();
  });
});

describe('conflictsLeftMessage', () => {
  it('namesTheFileAndCount_andTheWayAround', () => {
    expect(conflictsLeftMessage('app.ts', 2)).toBe(
      'app.ts still has 2 conflicts. Resolve them, or choose Mark Resolved Anyway to stage it as it is.',
    );
  });
});

describe('parseConflicts', () => {
  it('locatesEachMarker_byItsLine', () => {
    expect(parseConflicts(`a\n${CONFLICT}\nb`)).toEqual([
      { start: 2, base: null, divider: 4, end: 6 },
    ]);
  });

  it('findsADiff3BaseSection_betweenTheOpenerAndTheDivider', () => {
    const text: string = [
      '<<<<<<< HEAD',
      'ours',
      '||||||| merged common ancestor',
      'base',
      '=======',
      'theirs',
      '>>>>>>> feature',
    ].join('\n');

    expect(parseConflicts(text)).toEqual([{ start: 1, base: 3, divider: 5, end: 7 }]);
  });

  it.each([
    ['a heading underline', 'Title\n=======\nText'],
    ['an opener with no divider', '<<<<<<< HEAD\nours\n>>>>>>> feature'],
    ['a marker that does not start its line', '  <<<<<<< HEAD\nx\n=======\ny\n>>>>>>> f'],
    ['an eighth angle bracket', '<<<<<<<< HEAD\nx\n=======\ny\n>>>>>>> f'],
  ])('countsNothing_for %s', (_label: string, text: string) => {
    expect(parseConflicts(text)).toEqual([]);
  });

  it('startsOver_atAnOpenerInsideAnUnfinishedBlock', () => {
    // Markers never nest; a stray opener belongs to the block that follows it.
    const text: string = ['<<<<<<< HEAD', 'stray', CONFLICT].join('\n');

    expect(parseConflicts(text)).toEqual([{ start: 3, base: null, divider: 5, end: 7 }]);
  });

  it('readsWindowsLineEndings', () => {
    expect(countConflicts(CONFLICT.replace(/\n/g, '\r\n'))).toBe(1);
  });
});

describe('resolveConflictLines', () => {
  const lines: readonly string[] = [
    '<<<<<<< HEAD',
    'mine 1',
    'mine 2',
    '||||||| base',
    'original',
    '=======',
    'theirs 1',
    '>>>>>>> feature',
  ];
  const block: ConflictBlock = { start: 1, base: 4, divider: 6, end: 8 };

  it.each([
    ['top', ['mine 1', 'mine 2']],
    ['bottom', ['theirs 1']],
    ['both', ['mine 1', 'mine 2', 'theirs 1']],
  ] as const)(
    'keeps %s_andNeverTheBase',
    (choice: 'top' | 'bottom' | 'both', kept: readonly string[]) => {
      expect(resolveConflictLines(lines, block, choice)).toEqual(kept);
    },
  );
});

describe('choiceForSide', () => {
  it('keepsTheTopForYours_inAMerge_andTheBottomInARebase', () => {
    // In a rebase the branch being replayed onto is written above the divider: the user's own commit
    // is below it.
    expect(choiceForSide('yours', false)).toBe('top');
    expect(choiceForSide('theirs', false)).toBe('bottom');
    expect(choiceForSide('yours', true)).toBe('bottom');
    expect(choiceForSide('theirs', true)).toBe('top');
  });
});
