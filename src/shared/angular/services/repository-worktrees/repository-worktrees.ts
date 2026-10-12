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
