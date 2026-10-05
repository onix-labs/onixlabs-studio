import * as path from 'node:path';

/**
 * The part of the main process's open-workspace registry a run's root is checked against.
 */
export interface OpenRoots {
  /**
   * Determines whether a path is an open workspace root or lies inside one.
   * @param target The path to test.
   * @returns Returns true when the path is within an open workspace root.
   */
  isWithin(target: unknown): boolean;
}

/**
 * The outcome of checking a run's root: accepted, or refused with the reason the user is shown.
 */
export type RunRootCheck = { readonly ok: true } | { readonly ok: false; readonly detail: string };

/**
 * Checks the workspace root an untrusted run request names (#810). The root becomes the agent's
 * working directory and the root of its write confinement, and is stamped into the scope every
 * capability request carries, so main accepts it only when it is an open workspace root or lies inside
 * one — which is where a worktree container's checkouts live (#351). A run with no root (an editor or
 * top-level agent) is unaffected.
 * @param root The root the renderer sent.
 * @param open The open workspace roots.
 * @returns Returns whether the run may proceed, and why not when it may not.
 */
export function checkRunRoot(root: string | null, open: OpenRoots): RunRootCheck {
  if (root === null) {
    return { ok: true };
  }
  if (path.isAbsolute(root) && open.isWithin(root)) {
    return { ok: true };
  }
  return {
    ok: false,
    detail: `The agent can't run in ${root || '(empty path)'}: it isn't an open workspace. Open the folder, then try again.`,
  };
}
