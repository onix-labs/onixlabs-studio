import type { HostedPullRequest } from '@shared/api/hosting-protocol';
import { BranchMerge, branchMerge } from './branch-merge';
import type { MergedBranch, MergedRemoteBranch } from './merged-branch';
import type { GitBranch, GitRemote, GitRemoteBranch } from './repository-data';

/**
 * The names taken as a default branch when the plugin does not say which it is (one before protocol
 * 1.6, or a remote whose `HEAD` is unknown). Leaving a merged `main` or `master` alone is the safe
 * mistake to make.
 */
const CONVENTIONAL_DEFAULT_BRANCHES: readonly string[] = ['main', 'master'];

/**
 * Lists the local branches Delete Merged Branches offers to delete (#887), in the order the panel
 * lists them: those whose work is already in the default branch, by ancestry or through a merged pull
 * request (see {@link branchMerge}).
 *
 * ⛔ Never offered: the checked-out branch, a branch checked out in another worktree (git cannot delete
 * either from under it), and the default branch, which everything else is measured against. When the
 * plugin does not name the default branch, every branch others are merged into is taken as one, and so
 * are `main` and `master`.
 *
 * A branch's copy on a remote is offered only when it is safe to lose: see {@link upstreamOnRemote}.
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
    if (branch.current || branch.otherWorktree !== undefined || protectedNames.has(branch.name)) {
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
 * Finds a merged branch's upstream on its remote, when deleting it there loses nothing.
 *
 * ⛔ Offered only when all of these hold:
 * - it is the branch's upstream, still among the remote-tracking branches, and not `[gone]`;
 * - it holds nothing the local branch was not found merged with: its commit is the local tip, or is
 *   itself merged into the default branch. A copy someone pushed to after the merge is never offered,
 *   and the delete carries the commit it expects, so one pushed to after the last fetch is refused by
 *   the remote;
 * - it is not that remote's own default branch (a fork's `upstream/develop`), nor, for a remote whose
 *   default is unknown, any of the names protected locally.
 * @param branch The local branch.
 * @param remotes The remotes and their remote-tracking branches.
 * @param protectedNames The default branch's possible names.
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
  const tracking: GitRemoteBranch | undefined = remote?.branches.find(
    (candidate: GitRemoteBranch): boolean => candidate.name === upstream,
  );
  if (remote === undefined || tracking === undefined) {
    return undefined;
  }
  if (tracking.commit !== branch.tip && tracking.mergedInto === undefined) {
    return undefined;
  }
  const name: string = upstream.slice(remote.name.length + 1);
  const remoteDefaults: ReadonlySet<string> =
    remote.defaultBranch === undefined
      ? new Set<string>([...protectedNames, ...CONVENTIONAL_DEFAULT_BRANCHES])
      : new Set<string>([remote.defaultBranch, ...protectedNames]);
  if (name === 'HEAD' || remoteDefaults.has(name)) {
    return undefined;
  }
  return { remote: remote.name, name, expected: tracking.commit };
}
