import { InjectionToken, Signal } from '@angular/core';
import type { ConflictSides } from '@shared/angular/services/repository/conflict-resolution';
import type { MutationResult } from '@shared/angular/services/source-control/source-control-provider';

/**
 * What a code editor needs to know about the repository its file sits in while a merge or rebase has
 * stopped on conflicts (#1321): what the two sides are called, which way round git wrote them, and
 * whether this file is one git left conflicted, so the editor can offer Mark Resolved once its last
 * conflict is gone.
 *
 * A seam rather than the workspace's own service, so the code editor names no feature: a view that
 * holds a repository provides it, and an editor outside one (a standalone code tab) has none and still
 * resolves conflicts, with the sides unnamed.
 */
export interface ConflictContext {
  /**
   * Gets the names of the two sides, as the Commit panel shows them.
   */
  readonly conflictSides: Signal<ConflictSides>;

  /**
   * Gets whether git wrote the user's own work below the divider rather than above it — true in a
   * rebase, where git's `ours` is the branch being replayed onto.
   */
  readonly conflictMarkersSwapped: Signal<boolean>;

  /**
   * Gets whether git left a file conflicted. Reads signals, so a computed that calls it follows the
   * repository's status.
   * @param path The file's absolute path.
   * @returns Returns true when the file is conflicted.
   */
  isConflicted(path: string): boolean;

  /**
   * Marks files resolved by staging them. Refuses one that still holds conflict markers unless told
   * the markers are meant.
   * @param paths The files' absolute paths.
   * @param anyway Whether to stage a file that still holds markers.
   * @returns Returns the outcome.
   */
  markResolved(paths: readonly string[], anyway?: boolean): Promise<MutationResult>;
}

/**
 * Provides the view's {@link ConflictContext}. Optional: an editor outside a repository has none.
 */
export const CONFLICT_CONTEXT: InjectionToken<ConflictContext> =
  new InjectionToken<ConflictContext>('CONFLICT_CONTEXT');
