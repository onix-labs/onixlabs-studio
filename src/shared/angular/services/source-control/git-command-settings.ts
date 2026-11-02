import type { VcsPullMode, VcsSignCommits } from '@shared/api/version-control-protocol';

/**
 * Describes the Version Control settings a git operation runs with, read fresh for every operation so
 * a change applies to the next one.
 */
export interface GitCommandSettings {
  /**
   * Gets whether a fetch removes remote-tracking branches deleted on the remote (Prune on Fetch).
   */
  readonly prune: boolean;

  /**
   * Gets how a pull integrates the upstream (Pull Mode).
   */
  readonly pullMode: VcsPullMode;

  /**
   * Gets how long a fetch, pull or push may take, in milliseconds, or 0 for no limit.
   */
  readonly networkTimeoutMs: number;

  /**
   * Gets whether commits are signed (Sign Commits).
   */
  readonly sign: VcsSignCommits;

  /**
   * Gets whether commits carry a Signed-off-by trailer (Add Signed-off-by).
   */
  readonly signoff: boolean;

  /**
   * Gets whether the repository's commit hooks run (Run Commit Hooks).
   */
  readonly hooks: boolean;

  /**
   * Gets whether a stash takes untracked files too (Stash Includes Untracked Files).
   */
  readonly stashUntracked: boolean;
}
