import type { BranchMerge } from './branch-merge';

/**
 * Names a merged branch's copy on a remote, which Delete Merged Branches can delete as well (#887).
 */
export interface MergedRemoteBranch {
  /**
   * Gets the remote's name, as `origin`.
   */
  readonly remote: string;

  /**
   * Gets the branch's name on the remote, without the remote: `feature`, not `origin/feature`.
   */
  readonly name: string;

  /**
   * Gets the commit the remote's branch must still point at for the delete to go ahead: the one last
   * fetched, which was found merged. Anything pushed since is refused by the remote, never lost.
   */
  readonly expected: string;
}

/**
 * Describes a local branch Delete Merged Branches offers to delete (#887): one whose work is already in
 * the default branch, by ancestry or through a merged pull request.
 */
export interface MergedBranch {
  /**
   * Gets the local branch's name.
   */
  readonly name: string;

  /**
   * Gets how it was merged, which the dialog says beside it.
   */
  readonly merge: BranchMerge;

  /**
   * Gets the branch it tracks on a remote, when that branch still exists there, or undefined when it
   * tracks nothing, its upstream is gone, or the upstream is the remote's default branch.
   */
  readonly remoteBranch?: MergedRemoteBranch;
}
