import type { HostedPullRequest } from '@shared/api/hosting-protocol';
import type { GitBranch } from './repository-data';

/**
 * Says where a local branch's work went (#887): into the default branch by ancestry, or through a pull
 * request the host merged.
 */
export type BranchMerge =
  | {
      /**
       * Discriminates a merge found by ancestry: the tip is reachable from the default branch.
       */
      readonly kind: 'local';

      /**
       * Gets the default branch it was merged into.
       */
      readonly into: string;
    }
  | {
      /**
       * Discriminates a merge found through the host: a squash or rebase merge leaves the tip
       * unreachable, so only the pull request says it was merged.
       */
      readonly kind: 'pull-request';

      /**
       * Gets the pull request's number.
       */
      readonly number: number;
    };

/**
 * Decides whether a local branch has been merged, and how (#887). Ancestry first, from the
 * version-control plugin; then the host's merged pull requests, which find squash and rebase merges.
 *
 * ⛔ A branch counts as merged by a pull request only while its tip is still the commit the pull
 * request merged: a branch with commits made after the merge has work nowhere else, so it is not
 * marked. A pull request that does not say which commit it merged (a hosting plugin before protocol 1.5)
 * marks nothing.
 * @param branch The local branch.
 * @param mergedPullRequests The host's merged pull requests.
 * @returns Returns how the branch was merged, or null when it was not, or it cannot be told.
 */
export function branchMerge(
  branch: GitBranch,
  mergedPullRequests: readonly HostedPullRequest[],
): BranchMerge | null {
  if (branch.mergedInto !== undefined) {
    return { kind: 'local', into: branch.mergedInto };
  }
  const pullRequest: HostedPullRequest | undefined = mergedPullRequests.find(
    (candidate: HostedPullRequest): boolean =>
      candidate.state === 'merged' &&
      candidate.headRef === branch.name &&
      candidate.headSha !== undefined &&
      candidate.headSha === branch.tip,
  );
  return pullRequest === undefined ? null : { kind: 'pull-request', number: pullRequest.number };
}

/**
 * Words where a merged branch's work went, for its tooltip.
 * @param merge How it was merged.
 * @returns Returns the sentence.
 */
export function describeBranchMerge(merge: BranchMerge): string {
  return merge.kind === 'local'
    ? `Merged locally: everything on it is already in ${merge.into}`
    : `Merged via pull request #${merge.number}`;
}
