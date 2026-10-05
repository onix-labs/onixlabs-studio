import { describe, expect, it } from 'vitest';
import { VcsOperationState } from './protocol';
import { classifyOperation, OperationProbe } from './git-operation-state';

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

describe('git-operation-state', () => {
  describe('classifyOperation', () => {
    it('reportsNothingInFlight_whenGitLeftNoStateFiles', () => {
      expect(classifyOperation(probe())).toEqual({ kind: null });
    });

    it('readsAMerge_andNamesWhatIsBeingMergedFromItsMessage', () => {
      const state: VcsOperationState = classifyOperation(
        probe({ mergeHead: true, mergeMessage: "Merge branch 'topic' into main" }),
      );

      expect(state.kind).toBe('merge');
      expect(state.target).toBe('topic');
    });

    it('readsAMergeWithNoNameToGive_withoutInventingOne', () => {
      // The message is git's prose, not a contract. A line that names nothing yields no target, and
      // the panel says a merge is in flight without claiming to know what it is merging.
      const state: VcsOperationState = classifyOperation(
        probe({ mergeHead: true, mergeMessage: 'Merge made by the ort strategy' }),
      );

      expect(state.kind).toBe('merge');
      expect(state.target).toBeUndefined();
    });

    it('readsASquashMerge_whichHasNoMergeHeadToRecogniseItBy', () => {
      // The distinction is not cosmetic: `git merge --abort` and `--continue` both refuse here,
      // because as far as git is concerned no merge is in progress at all.
      const state: VcsOperationState = classifyOperation(
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
      const state: VcsOperationState = classifyOperation(
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
      const state: VcsOperationState = classifyOperation(
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
      const state: VcsOperationState = classifyOperation(
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
