import { describe, expect, it } from 'vitest';
import {
  choiceForSide,
  ConflictBlock,
  ConflictRegion,
  conflictSides,
  ConflictVersions,
  conflictVersions,
  mapConflictLine,
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

describe('parseConflicts at the edges', () => {
  it('findsAConflict_whoseCloserIsTheFilesLastLine_withNoNewlineAfterIt', () => {
    expect(parseConflicts(`a\n${CONFLICT}`)).toEqual([
      { start: 2, base: null, divider: 4, end: 6 },
    ]);
  });

  it('findsAConflict_whoseCloserIsFollowedByTheFilesLastNewline', () => {
    expect(parseConflicts(`${CONFLICT}\n`)).toEqual([{ start: 1, base: null, divider: 3, end: 5 }]);
  });

  it('findsADiff3Conflict_withWindowsLineEndings', () => {
    const text: string = [
      'before',
      '<<<<<<< HEAD',
      'ours',
      '||||||| 1a2b3c4',
      'base',
      '=======',
      'theirs',
      '>>>>>>> feature',
      'after',
    ].join('\r\n');

    expect(parseConflicts(text)).toEqual([{ start: 2, base: 4, divider: 6, end: 8 }]);
  });

  it('readsAZdiff3BaseSection_whichGitWritesTheSameWay', () => {
    // zdiff3 moves lines both sides share out of the block; what is left is marked as diff3 is.
    const text: string = [
      'shared',
      '<<<<<<< HEAD',
      'ours',
      '||||||| base',
      '=======',
      '>>>>>>> f',
    ].join('\n');

    expect(parseConflicts(text)).toEqual([{ start: 2, base: 4, divider: 5, end: 6 }]);
  });

  it('startsOver_atAnOpenerBelowTheDivider_ofAnUnfinishedBlock', () => {
    // A marker-looking line in their section that opens another block: git never nests, so the
    // innermost complete block is the conflict.
    const text: string = [
      '<<<<<<< HEAD',
      'ours',
      '=======',
      '<<<<<<< inner',
      'x',
      '=======',
      'y',
      '>>>>>>> inner',
    ].join('\n');

    expect(parseConflicts(text)).toEqual([{ start: 4, base: null, divider: 6, end: 8 }]);
  });

  it('ignoresACloserBeforeTheDivider_andASecondDivider', () => {
    const text: string = [
      '<<<<<<< HEAD',
      '>>>>>>> not yet',
      '=======',
      '=======',
      '>>>>>>> feature',
    ].join('\n');

    expect(parseConflicts(text)).toEqual([{ start: 1, base: null, divider: 3, end: 5 }]);
  });

  it.each([
    ['a divider with trailing space', '<<<<<<< HEAD\nx\n======= \ny\n>>>>>>> f'],
    ['a closer run straight into text', '<<<<<<< HEAD\nx\n=======\ny\n>>>>>>>f'],
    ['a base marker after the divider only', '=======\n||||||| base\n>>>>>>> f'],
  ])('findsNothing_for %s', (_label: string, text: string) => {
    expect(parseConflicts(text)).toEqual([]);
  });

  it('readsLongerMarkers_setByConflictMarkerSize', () => {
    // `.gitattributes`: `*.md conflict-marker-size=10`.
    const text: string = [
      'Title',
      '=======',
      '<<<<<<<<<< HEAD',
      'ours',
      '|||||||||| base',
      'base',
      '==========',
      'theirs',
      '>>>>>>>>>> feature',
    ].join('\n');

    expect(parseConflicts(text)).toEqual([{ start: 3, base: 5, divider: 7, end: 9 }]);
    expect(countConflicts(text)).toBe(1);
  });

  it('needsEveryMarkerOfABlock_toBeTheSameLength', () => {
    const text: string = ['<<<<<<<<<< HEAD', 'ours', '=======', 'theirs', '>>>>>>> f'].join('\n');

    expect(parseConflicts(text)).toEqual([]);
  });

  it('acceptsEmptySections_onEitherSide', () => {
    const text: string = ['<<<<<<< HEAD', '=======', '>>>>>>> feature'].join('\n');

    expect(parseConflicts(text)).toEqual([{ start: 1, base: null, divider: 2, end: 3 }]);
    expect(resolveConflictLines(text.split('\n'), parseConflicts(text)[0], 'both')).toEqual([]);
  });
});

describe('conflictVersions', () => {
  const merged: string = [
    'one',
    '<<<<<<< HEAD',
    'mine',
    '=======',
    'theirs a',
    'theirs b',
    '>>>>>>> feature',
    'two',
    '<<<<<<< HEAD',
    '=======',
    'added by them',
    '>>>>>>> feature',
    'three',
  ].join('\n');

  it('givesEachSide_withEverythingOutsideTheConflictsShared', () => {
    const versions: ConflictVersions = conflictVersions(merged, false);

    expect(versions.yours).toBe(['one', 'mine', 'two', 'three'].join('\n'));
    expect(versions.theirs).toBe(
      ['one', 'theirs a', 'theirs b', 'two', 'added by them', 'three'].join('\n'),
    );
    expect(versions.base).toBeNull();
  });

  it('placesEachConflict_inEveryPane', () => {
    const versions: ConflictVersions = conflictVersions(merged, false);

    expect(versions.regions).toEqual([
      {
        result: { start: 2, count: 6 },
        yours: { start: 2, count: 1 },
        theirs: { start: 2, count: 2 },
        base: null,
      },
      {
        // Yours removed nothing and added nothing here: an empty run before the line after it.
        result: { start: 9, count: 4 },
        yours: { start: 4, count: 0 },
        theirs: { start: 5, count: 1 },
        base: null,
      },
    ]);
  });

  it('swapsTheSections_inARebase', () => {
    // In a rebase git writes the upstream above the divider; the user's own commit is below it.
    const versions: ConflictVersions = conflictVersions(merged, true);

    expect(versions.yours).toBe(
      ['one', 'theirs a', 'theirs b', 'two', 'added by them', 'three'].join('\n'),
    );
    expect(versions.theirs).toBe(['one', 'mine', 'two', 'three'].join('\n'));
  });

  it('givesTheCommonAncestor_whenEveryConflictHasADiff3Base', () => {
    const text: string = [
      'a',
      '<<<<<<< HEAD',
      'mine',
      '||||||| base',
      'original 1',
      'original 2',
      '=======',
      'theirs',
      '>>>>>>> feature',
      'b',
    ].join('\n');

    const versions: ConflictVersions = conflictVersions(text, false);

    expect(versions.base).toBe(['a', 'original 1', 'original 2', 'b'].join('\n'));
    expect(versions.regions[0].base).toEqual({ start: 2, count: 2 });
    expect(versions.yours).toBe(['a', 'mine', 'b'].join('\n'));
  });

  it('givesNoAncestor_whenOnlySomeConflictsHaveOne', () => {
    const text: string = [
      '<<<<<<< HEAD',
      'x',
      '||||||| base',
      'o',
      '=======',
      'y',
      '>>>>>>> f',
      CONFLICT,
    ].join('\n');

    expect(conflictVersions(text, false).base).toBeNull();
  });

  it('keepsWindowsLineEndings_andTheFilesLastNewline', () => {
    const text: string = `a\r\n${CONFLICT.replace(/\n/g, '\r\n')}\r\n`;

    const versions: ConflictVersions = conflictVersions(text, false);

    expect(versions.yours).toBe('a\r\nours\r\n');
    expect(versions.theirs).toBe('a\r\ntheirs\r\n');
  });

  it('handlesAConflictThatEndsTheFile', () => {
    const versions: ConflictVersions = conflictVersions(`a\n${CONFLICT}`, false);

    expect(versions.yours).toBe('a\nours');
    expect(versions.regions[0].result).toEqual({ start: 2, count: 5 });
  });

  it('isTheFileItself_whenNothingIsConflicted', () => {
    const versions: ConflictVersions = conflictVersions('a\nb\n', false);

    expect(versions).toEqual({ yours: 'a\nb\n', theirs: 'a\nb\n', base: null, regions: [] });
  });
});

describe('mapConflictLine', () => {
  // one / [6-line conflict: yours 1 line, theirs 2] / two / [4-line conflict: yours 0, theirs 1] / three
  const regions: readonly ConflictRegion[] = conflictVersions(
    [
      'one',
      '<<<<<<< HEAD',
      'mine',
      '=======',
      'theirs a',
      'theirs b',
      '>>>>>>> feature',
      'two',
      '<<<<<<< HEAD',
      '=======',
      'added by them',
      '>>>>>>> feature',
      'three',
    ].join('\n'),
    false,
  ).regions;

  it('leavesALineAboveEveryConflict_whereItIs', () => {
    expect(mapConflictLine(1, regions, 'result', 'yours')).toBe(1);
  });

  it('mapsALineBetweenConflicts_byTheDifferenceTheConflictsAboveMake', () => {
    // "two" is line 8 of the file, 3 of Yours and 4 of Theirs.
    expect(mapConflictLine(8, regions, 'result', 'yours')).toBe(3);
    expect(mapConflictLine(8, regions, 'result', 'theirs')).toBe(4);
    expect(mapConflictLine(3, regions, 'yours', 'theirs')).toBe(4);
  });

  it('mapsALineBelowEveryConflict', () => {
    // "three": 13 of the file, 4 of Yours, 6 of Theirs.
    expect(mapConflictLine(13, regions, 'result', 'yours')).toBe(4);
    expect(mapConflictLine(6, regions, 'theirs', 'result')).toBe(13);
  });

  it('mapsALineInsideAConflict_intoTheOtherSection_clampedToItsLength', () => {
    expect(mapConflictLine(2, regions, 'result', 'theirs')).toBe(2);
    expect(mapConflictLine(4, regions, 'result', 'theirs')).toBe(3);
    // Yours has one line there, so everything deeper lands on it.
    expect(mapConflictLine(6, regions, 'result', 'yours')).toBe(2);
    expect(mapConflictLine(3, regions, 'theirs', 'yours')).toBe(2);
  });

  it('mapsIntoAnEmptySection_ontoTheLineAfterWhereItWouldBe', () => {
    expect(mapConflictLine(10, regions, 'result', 'yours')).toBe(4);
    expect(mapConflictLine(5, regions, 'theirs', 'yours')).toBe(4);
  });

  it('leavesTheLineAlone_forABasePaneTheFileDoesNotHave', () => {
    expect(mapConflictLine(8, regions, 'result', 'base')).toBe(8);
  });
});
