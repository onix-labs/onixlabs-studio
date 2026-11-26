import type { VcsBranch, VcsRefs, VcsRemote, VcsRemoteBranch } from './protocol';

/**
 * Describes the default branch merges are measured against (#887).
 */
export interface DefaultBranch {
  /**
   * Gets the full ref to ask git against: `refs/remotes/origin/main`, or `refs/heads/main`.
   */
  readonly ref: string;

  /**
   * Gets the branch's short name, without any remote: `main`.
   */
  readonly name: string;

  /**
   * Gets the commit it points at.
   */
  readonly tip: string;
}

/**
 * Finds the default branch to measure merges against: the remote-tracking branch a remote's `HEAD`
 * points at (`origin`'s first, then the other remotes'), or else a local `main` or `master`.
 * @param refs The parsed refs.
 * @param heads Each remote's `HEAD`, as the remote-tracking branch it names (`origin/main`).
 * @returns Returns the default branch, or null when there is none.
 */
export function defaultBranchOf(
  refs: VcsRefs,
  heads: ReadonlyMap<string, string>,
): DefaultBranch | null {
  const remotes: readonly VcsRemote[] = [
    ...refs.remotes.filter((remote: VcsRemote): boolean => remote.name === 'origin'),
    ...refs.remotes.filter((remote: VcsRemote): boolean => remote.name !== 'origin'),
  ];
  for (const remote of remotes) {
    const tracking: string | undefined = heads.get(remote.name);
    const branch: VcsRemoteBranch | undefined = remote.branches.find(
      (candidate: VcsRemoteBranch): boolean => candidate.name === tracking,
    );
    if (tracking !== undefined && branch !== undefined) {
      return {
        ref: `refs/remotes/${tracking}`,
        name: tracking.slice(remote.name.length + 1),
        tip: branch.commit,
      };
    }
  }
  for (const name of ['main', 'master']) {
    const local: VcsBranch | undefined = refs.branches.find(
      (branch: VcsBranch): boolean => branch.name === name,
    );
    if (local !== undefined) {
      return { ref: `refs/heads/${name}`, name, tip: local.tip };
    }
  }
  return null;
}
