import { InjectionToken, Signal } from '@angular/core';
import type { WorktreeBranch } from '@shared/api/worktree';

/**
 * One worktree of the repository, as the Repository panel's Local section lists it: a checkout, with
 * its own local branches beneath it and its checked-out branch highlighted among them.
 */
export interface RepositoryWorktree {
  /**
   * Gets the checkout's stable identifier.
   */
  readonly id: string;

  /**
   * Gets the checkout's display label: its alias, else its branch.
   */
  readonly label: string;

  /**
   * Gets the checkout's directory, for revealing and copying.
   */
  readonly path: string;

  /**
   * Gets the branch the checkout has checked out, or null while it cannot be read.
   */
  readonly branch: string | null;

  /**
   * Gets the number of changed working-tree entries, or null while it cannot be read.
   */
  readonly changes: number | null;

  /**
   * Gets the checkout's local branches. Each worktree is a full clone, so each has a set of its own.
   */
  readonly branches: readonly WorktreeBranch[];

  /**
   * Gets a value indicating whether this is the checkout the view is scoped to.
   */
  readonly current: boolean;

  /**
   * Gets a value indicating whether another checkout has the same branch checked out.
   */
  readonly duplicateBranch: boolean;
}

/**
 * Describes how deleting another worktree's branch went: deleted, refused for unmerged commits (so
 * the panel asks whether to lose them), or failed for another reason, which the feature reports.
 */
export type WorktreeBranchDeletion = 'deleted' | 'not-merged' | 'failed';

/**
 * The repository's worktrees, as the Repository panel reads and acts on them. A seam: the panel is
 * shared, while worktrees are the workspace feature's — so the feature provides this, and a view
 * without it (or a repository that is not a worktree container) reads as a flat repository.
 */
export interface RepositoryWorktrees {
  /**
   * Gets the worktrees in registration order, or null for a flat repository (one checkout, no
   * container).
   */
  readonly worktrees: Signal<readonly RepositoryWorktree[] | null>;

  /**
   * Gets a value indicating whether a worktree is being created or removed.
   */
  readonly busy: Signal<boolean>;

  /**
   * Gets a value indicating whether the flat repository can be converted to worktrees.
   */
  readonly canConvert: Signal<boolean>;

  /**
   * Gets why the flat repository cannot be converted right now — its agent at work in the folder —
   * or null when nothing stands in the way.
   */
  readonly convertBlocker: Signal<string | null>;

  /**
   * Asks to convert the flat repository to worktrees: the feature confirms with the user first,
   * since it restructures the folder on disk.
   */
  requestConvert(): void;

  /**
   * Scopes the view to a worktree.
   * @param id The checkout id.
   */
  activate(id: string): void;

  /**
   * Asks for a new worktree: the feature puts its New Worktree dialog in front of the user.
   */
  requestAdd(): void;

  /**
   * Renames a worktree. The name is its label only; nothing on disk changes. A failure is reported
   * by the feature.
   * @param id The checkout id.
   * @param name The new name, trimmed and not empty.
   */
  rename(id: string, name: string): void;

  /**
   * Asks to remove a worktree: the feature confirms with the user first. Ignored for the last one.
   * @param id The checkout id.
   */
  requestRemove(id: string): void;

  /**
   * Deletes a local branch in a worktree, which need not be the one the view is on: each worktree is
   * a clone of its own. The panel confirms first; a failure other than unmerged commits is reported
   * by the feature.
   * @param id The checkout id.
   * @param name The branch to delete.
   * @param force Whether to delete it even with unmerged commits.
   * @returns Returns how it went.
   */
  deleteBranch(id: string, name: string, force: boolean): Promise<WorktreeBranchDeletion>;

  /**
   * Creates a local branch in a worktree, at that worktree's head. A failure is reported by the
   * feature.
   * @param id The checkout id.
   * @param name The branch to create.
   * @param checkout Whether to check it out in that worktree.
   * @returns Returns true once the branch exists.
   */
  createBranch(id: string, name: string, checkout: boolean): Promise<boolean>;

  /**
   * Re-reads every worktree's status and branches.
   */
  refresh(): void;
}

/**
 * Provides the view's {@link RepositoryWorktrees}. Optional: a view that does not provide it shows a
 * flat repository.
 */
export const REPOSITORY_WORKTREES: InjectionToken<RepositoryWorktrees> =
  new InjectionToken<RepositoryWorktrees>('REPOSITORY_WORKTREES');
