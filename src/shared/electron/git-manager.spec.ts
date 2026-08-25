import { GitOperationState } from '../api/source-control-channels';
import { blobSpec, classifyOperation, INDEX_REVISION, OperationProbe } from './git-manager';

/**
 * Builds a probe of a repository with nothing in flight, overridden per test with the state files the
 * operation under test would have left.
 * @param overrides The state files that are present.
 * @returns Returns the probe.
 */
function probe(overrides: Partial<OperationProbe> = {}): OperationProbe {
  return {
    rebaseMerge: false,
    rebaseApply: false,
    mergeHead: false,
    cherryPickHead: false,
    revertHead: false,
    squashMessage: false,
    headName: null,
    ontoName: null,
    step: null,
    total: null,
    mergeMessage: null,
    ...overrides,
  };
}

describe('git-manager', () => {
  describe('blobSpec', () => {
    it('joinsARealRevisionToItsPath', () => {
      expect(blobSpec('HEAD', 'README.md')).toBe('HEAD:README.md');
      expect(blobSpec('abc123', 'src/app/main.ts')).toBe('abc123:src/app/main.ts');
    });

    it('keepsARevisionExpressionIntact', () => {
      // A commit's diff reads its parent as `<hash>^` when the parent is not named outright.
      expect(blobSpec('abc123^', 'README.md')).toBe('abc123^:README.md');
    });

    it('doesNotDoubleTheSeparator_whenTheRevisionIsTheIndex', () => {
      // The index blob is `:path` — the revision is the empty name before the colon, so writing the
      // colon again yields `::path`, which git rejects as an ambiguous argument. That rejection was
      // indistinguishable from an absent blob, so every working-tree diff silently lost the side that
      // came from the index: unstaged files read as wholly added, staged ones as wholly deleted.
      expect(blobSpec(INDEX_REVISION, 'README.md')).toBe(':README.md');
      expect(blobSpec(INDEX_REVISION, 'README.md')).not.toBe('::README.md');
    });

    it('leavesAPathWithColonsAlone_soOnlyTheSeparatorIsAdded', () => {
      // The path is git's operand, not part of the revision expression; nothing here rewrites it.
      expect(blobSpec('HEAD', 'weird:name.ts')).toBe('HEAD:weird:name.ts');
    });
  });

  describe('classifyOperation', () => {
    it('reportsNothingInFlight_whenGitLeftNoStateFiles', () => {
      expect(classifyOperation(probe())).toEqual({ kind: null });
    });

    it('readsAMerge_andNamesWhatIsBeingMergedFromItsMessage', () => {
      const state: GitOperationState = classifyOperation(
        probe({ mergeHead: true, mergeMessage: "Merge branch 'topic' into main" }),
      );

      expect(state.kind).toBe('merge');
      expect(state.target).toBe('topic');
    });

    it('readsAMergeWithNoNameToGive_withoutInventingOne', () => {
      // The message is git's prose, not a contract. A line that names nothing yields no target, and
      // the panel says a merge is in flight without claiming to know what it is merging.
      const state: GitOperationState = classifyOperation(
        probe({ mergeHead: true, mergeMessage: 'Merge made by the ort strategy' }),
      );

      expect(state.kind).toBe('merge');
      expect(state.target).toBeUndefined();
    });

    it('readsASquashMerge_whichHasNoMergeHeadToRecogniseItBy', () => {
      // The distinction is not cosmetic: `git merge --abort` and `--continue` both refuse here,
      // because as far as git is concerned no merge is in progress at all.
      const state: GitOperationState = classifyOperation(
        probe({ squashMessage: true, mergeMessage: "Squashed commit of 'topic'" }),
      );

      expect(state.kind).toBe('squash-merge');
      expect(state.target).toBe('topic');
    });

    it('prefersAPlainMergeOverASquash_whenBothMessagesArePresent', () => {
      // A merge writes MERGE_MSG too, so SQUASH_MSG alone is what distinguishes a squash — and only
      // once MERGE_HEAD has been ruled out.
      expect(classifyOperation(probe({ mergeHead: true, squashMessage: true })).kind).toBe('merge');
    });

    it('readsARebase_withItsBranchTargetAndProgress', () => {
      const state: GitOperationState = classifyOperation(
        probe({
          rebaseMerge: true,
          headName: 'refs/heads/feature/thing',
          ontoName: 'main',
          step: '2',
          total: '5',
        }),
      );

      expect(state).toEqual({
        kind: 'rebase',
        branch: 'feature/thing',
        target: 'main',
        step: 2,
        total: 5,
      });
    });

    it('readsARebaseFromTheOlderBackend_whoseFilesAreNamedDifferently', () => {
      // `rebase-apply` is the patch-applying backend; the caller reads `next`/`last` into the same
      // fields, so the classifier needs to know nothing about which backend ran.
      const state: GitOperationState = classifyOperation(
        probe({ rebaseApply: true, headName: 'refs/heads/topic', step: '1', total: '3' }),
      );

      expect(state.kind).toBe('rebase');
      expect(state.branch).toBe('topic');
      expect(state.step).toBe(1);
    });

    it('winsForARebase_evenWhenTheCommitItIsReplayingLooksLikeACherryPick', () => {
      // A rebase replays commits, which is what a cherry-pick does, and it can leave the same marker
      // behind. Testing the rebase directories first is what keeps the panel from offering
      // `cherry-pick --continue` to something that needs `rebase --continue`.
      expect(classifyOperation(probe({ rebaseMerge: true, cherryPickHead: true })).kind).toBe(
        'rebase',
      );
    });

    it('readsACherryPickAndARevert', () => {
      expect(classifyOperation(probe({ cherryPickHead: true })).kind).toBe('cherry-pick');
      expect(classifyOperation(probe({ revertHead: true })).kind).toBe('revert');
    });

    it('omitsProgress_whenTheCountersAreMissingOrUnreadable', () => {
      const state: GitOperationState = classifyOperation(
        probe({ rebaseMerge: true, step: '', total: 'not-a-number' }),
      );

      expect(state.step).toBeUndefined();
      expect(state.total).toBeUndefined();
    });

    it('leavesABranchNameAlone_whenItIsNotUnderRefsHeads', () => {
      // A rebase of a detached head writes the hash here rather than a ref.
      expect(classifyOperation(probe({ rebaseMerge: true, headName: 'abc1234' })).branch).toBe(
        'abc1234',
      );
    });
  });
});
