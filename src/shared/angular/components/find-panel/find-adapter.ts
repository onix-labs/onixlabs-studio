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

/**
 * Describes a single match within a file for the workspace results tree: its one-based line and
 * column and the text of the line it occurs on, for preview.
 */
export interface FindResultMatch {
  /**
   * Gets the one-based line number of the match.
   */
  readonly line: number;

  /**
   * Gets the one-based column at which the match begins.
   */
  readonly column: number;

  /**
   * Gets the text of the matching line, for preview.
   */
  readonly preview: string;
}

/**
 * Describes all matches within a single file for the workspace results tree.
 */
export interface FindResultFile {
  /**
   * Gets the absolute path of the file, used to open it.
   */
  readonly path: string;

  /**
   * Gets the file's path relative to the workspace root, for display.
   */
  readonly relativePath: string;

  /**
   * Gets the matches within the file, in document order.
   */
  readonly matches: readonly FindResultMatch[];
}

/**
 * Extends {@link FindAdapter} for a multi-file surface (the workspace): besides the flat match totals
 * the panel always shows, it exposes the matches grouped by file for the results tree, a busy flag
 * while a search runs, and the ability to open a match in its editor. The panel renders the tree only
 * for adapters that implement this interface, so single-document adapters remain unaffected.
 */
export interface WorkspaceFindAdapter extends FindAdapter {
  /**
   * Gets the current results grouped by file, in the order the search returned them.
   */
  readonly results: Signal<readonly FindResultFile[]>;

  /**
   * Gets a value indicating whether a search is currently running.
   */
  readonly searching: Signal<boolean>;

  /**
   * Opens a match in its editor, revealing the matched line.
   * @param file The file the match belongs to.
   * @param match The match to reveal.
   */
  openMatch(file: FindResultFile, match: FindResultMatch): void;
}

/**
 * Determines whether an adapter is a {@link WorkspaceFindAdapter} that backs a results tree.
 * @param adapter The adapter to test, or null.
 * @returns Returns true when the adapter exposes grouped results.
 */
export function isWorkspaceFindAdapter(
  adapter: FindAdapter | null,
): adapter is WorkspaceFindAdapter {
  return adapter !== null && 'results' in adapter;
}
