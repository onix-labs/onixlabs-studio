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
 * Describes a single match for the panel's results list: its position, a preview of the matched line
 * split around the match (so the match can be emphasised), and, for a multi-file surface, the file it
 * belongs to. Replacing a match drops it from the list (consistently across every surface), so there
 * is no replaced state to model.
 */
export interface FindResultItem {
  /**
   * Gets the one-based line number of the match.
   */
  readonly line: number;

  /**
   * Gets the one-based column at which the match begins.
   */
  readonly column: number;

  /**
   * Gets the line text before the match, trimmed to a preview length.
   */
  readonly before: string;

  /**
   * Gets the matched text.
   */
  readonly text: string;

  /**
   * Gets the line text after the match, trimmed to a preview length.
   */
  readonly after: string;

  /**
   * Gets the file's path relative to the searched root, for a multi-file surface; undefined for a
   * single-document surface.
   */
  readonly file?: string;
}

/**
 * Defines find-and-replace over a single surface's engine — a Monaco editor, a ProseMirror document,
 * or the workspace file set. The shared find panel holds whichever adapter its host surface supplies
 * and drives it; each surface implements the operations against its own engine, so the panel itself
 * contains no engine-specific code.
 *
 * The adapter owns all match state: the list, the active index, and the replace/undo history. The
 * panel is purely presentational — it renders {@link matches} and {@link activeIndex} and calls the
 * operations. Navigation is bounded (it does not wrap), so the panel can disable the ends.
 *
 * This is the seam the {@link Epic Shared Find & Replace panel} is built on, mirroring the codebase's
 * other per-surface adapters (for example the editor command handlers): one shared consumer, many
 * surface implementations, no duplication.
 */
export interface FindAdapter {
  /**
   * Gets the matches for the active query, in document (or file) order.
   */
  readonly matches: Signal<readonly FindResultItem[]>;

  /**
   * Gets the zero-based index of the active match within {@link matches}, or -1 when none is active.
   */
  readonly activeIndex: Signal<number>;

  /**
   * Gets a value indicating whether this surface supports replace. When false, the panel hides its
   * replace affordances and offers find only.
   */
  readonly supportsReplace: boolean;

  /**
   * Gets a value indicating whether the last replace can be undone.
   */
  readonly canUndo: Signal<boolean>;

  /**
   * Applies a query, refreshing the match set and its highlights. An empty query clears the matches.
   * @param query The query to search for.
   */
  setQuery(query: FindQuery): void;

  /**
   * Selects and reveals the match at the given index (for example when its list row is clicked).
   * @param index The zero-based index of the match to select.
   */
  select(index: number): void;

  /**
   * Selects and reveals the next match, stopping at the last (no wrap).
   */
  next(): void;

  /**
   * Selects and reveals the previous match, stopping at the first (no wrap).
   */
  previous(): void;

  /**
   * Replaces the active match with the replacement text; the replaced match drops from the list and
   * the selection advances to the match that takes its place.
   * @param replacement The text to replace the active match with.
   */
  replace(replacement: string): void;

  /**
   * Replaces every match with the replacement text; all replaced matches drop from the list.
   * @param replacement The text to replace each match with.
   */
  replaceAll(replacement: string): void;

  /**
   * Undoes the most recent replace, restoring the text and un-greying the affected match.
   */
  undo(): void;

  /**
   * Clears the active query and removes its highlights, called when the panel closes.
   */
  clear(): void;
}
