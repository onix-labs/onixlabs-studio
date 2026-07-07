import { Signal } from '@angular/core';

/**
 * Defines the query the find panel asks an adapter to search for. The options mirror the panel's
 * toggles; an adapter that cannot honour one (for example, a surface without regex support) treats it
 * as off.
 */
export interface FindQuery {
  /**
   * Gets the text (or, when {@link regexp} is set, the pattern) to search for.
   */
  readonly text: string;

  /**
   * Gets a value indicating whether the search is case-sensitive.
   */
  readonly caseSensitive: boolean;

  /**
   * Gets a value indicating whether the search matches whole words only.
   */
  readonly wholeWord: boolean;

  /**
   * Gets a value indicating whether {@link text} is a regular-expression pattern.
   */
  readonly regexp: boolean;
}

/**
 * Defines find-and-replace over a single surface's engine — a Monaco editor, a ProseMirror document,
 * or the workspace file set. The shared find panel holds whichever adapter its host surface supplies
 * and drives it; each surface implements the operations against its own engine, so the panel itself
 * contains no engine-specific code.
 *
 * This is the seam the {@link Epic Shared Find & Replace panel} is built on, mirroring the codebase's
 * other per-surface adapters (for example the editor command handlers): one shared consumer, many
 * surface implementations, no duplication.
 */
export interface FindAdapter {
  /**
   * Gets the total number of matches for the active query, or zero when the query is empty or unmatched.
   */
  readonly matchCount: Signal<number>;

  /**
   * Gets the one-based index of the active match within {@link matchCount}, or zero when there is none.
   */
  readonly activeMatch: Signal<number>;

  /**
   * Applies a query, refreshing the match set and its highlights. An empty query clears the matches.
   * @param query The query to search for.
   */
  setQuery(query: FindQuery): void;

  /**
   * Moves to and reveals the next match, wrapping past the end.
   */
  next(): void;

  /**
   * Moves to and reveals the previous match, wrapping before the start.
   */
  previous(): void;

  /**
   * Replaces the active match with the replacement text, then advances to the next match.
   * @param replacement The text to replace the active match with.
   */
  replace(replacement: string): void;

  /**
   * Replaces every match with the replacement text.
   * @param replacement The text to replace each match with.
   */
  replaceAll(replacement: string): void;

  /**
   * Clears the active query and removes its highlights, called when the panel closes.
   */
  clear(): void;
}
