import type { HostedPullRequest } from '@shared/api/hosting-protocol';
import { BranchMerge, branchMerge } from './branch-merge';
import type { MergedBranch, MergedRemoteBranch } from './merged-branch';
import type { GitBranch, GitRemote, GitRemoteBranch } from './repository-data';

/**
 * The names taken as the default branch when the plugin does not say which it is (one before protocol
 * 1.6). Leaving a merged `main` or `master` alone is the safe mistake to make.
 */
const CONVENTIONAL_DEFAULT_BRANCHES: readonly string[] = ['main', 'master'];

/**
 * Lists the local branches Delete Merged Branches offers to delete (#887), in the order the panel
 * lists them: those whose work is already in the default branch, by ancestry or through a merged pull
 * request (see {@link branchMerge}).
 *
 * ⛔ Two are never offered: the checked-out branch, which git cannot delete from under itself, and the
 * default branch, which everything else is measured against. When the plugin does not name the default
 * branch, every branch others are merged into is taken as one, and so are `main` and `master`.
 *
 * A branch's copy on a remote is offered only when it is the branch's upstream and is still there:
 * not gone (`[gone]`), still listed among the remote-tracking branches, and not the remote's default
 * branch.
 * @param branches The local branches.
 * @param mergedPullRequests The host's merged pull requests.
 * @param remotes The remotes and their remote-tracking branches.
 * @param defaultBranch The default branch, or undefined when the plugin did not say.
 * @returns Returns the branches to offer.
 */
export function mergedBranches(
  branches: readonly GitBranch[],
  mergedPullRequests: readonly HostedPullRequest[],
  remotes: readonly GitRemote[],
  defaultBranch: string | undefined,
): readonly MergedBranch[] {
  const protectedNames: ReadonlySet<string> = new Set<string>([
    ...(defaultBranch === undefined ? CONVENTIONAL_DEFAULT_BRANCHES : [defaultBranch]),
    ...branches
      .map((branch: GitBranch): string | undefined => branch.mergedInto)
      .filter((name: string | undefined): name is string => name !== undefined),
  ]);
  const offered: MergedBranch[] = [];
  for (const branch of branches) {
    if (branch.current || protectedNames.has(branch.name)) {
      continue;
    }
    const merge: BranchMerge | null = branchMerge(branch, mergedPullRequests);
    if (merge === null) {
      continue;
    }
    const remoteBranch: MergedRemoteBranch | undefined = upstreamOnRemote(
      branch,
      remotes,
      protectedNames,
    );
    offered.push({
      name: branch.name,
      merge,
      ...(remoteBranch === undefined ? {} : { remoteBranch }),
    });
  }
  return offered;
}

/**
 * Finds a branch's upstream on its remote, when it is still there and may be deleted.
 * @param branch The local branch.
 * @param remotes The remotes and their remote-tracking branches.
 * @param protectedNames The default branch's possible names, never deleted on a remote either.
 * @returns Returns the remote branch, or undefined when there is none to offer.
 */
function upstreamOnRemote(
  branch: GitBranch,
  remotes: readonly GitRemote[],
  protectedNames: ReadonlySet<string>,
): MergedRemoteBranch | undefined {
  const upstream: string | undefined = branch.upstream;
  if (upstream === undefined || branch.upstreamGone === true) {
    return undefined;
  }
  // Remote names may hold slashes, so the longest one the upstream starts with is its remote.
  const remote: GitRemote | undefined = [...remotes]
    .sort((left: GitRemote, right: GitRemote): number => right.name.length - left.name.length)
    .find((candidate: GitRemote): boolean => upstream.startsWith(`${candidate.name}/`));
  const stillThere: boolean =
    remote?.branches.some((tracking: GitRemoteBranch): boolean => tracking.name === upstream) ===
    true;
  if (remote === undefined || !stillThere) {
    return undefined;
  }
  const name: string = upstream.slice(remote.name.length + 1);
  if (name === 'HEAD' || protectedNames.has(name)) {
    return undefined;
  }
  return { remote: remote.name, name };
}
