import { Signal } from '@angular/core';
import { FindAdapter } from '@shared/angular/components/find-panel/find-adapter';
import { FindScope } from '@shared/angular/components/find-panel/find-request';
import { ReplaceResponse } from '@shared/api/search-channels';

/**
 * What a replace did, or null when there was nothing to replace.
 */
export type SearchReplaceOutcome = ReplaceResponse | null;

/**
 * Defines what the shared {@link import('./search-view').SearchView} drives (#1007): a
 * {@link FindAdapter} that also searches a chosen scope and replaces file by file — the workspace's
 * files on disk, or the Monaco models of open editors.
 *
 * The view asks for a search, lists the matches grouped by file, and replaces through it; whether a
 * replace writes files on disk (so a file with unsaved edits must be skipped) or edits a model (so it
 * joins the editor's own undo) is the adapter's to say.
 */
export interface SearchAdapter extends FindAdapter {
  /**
   * Gets the chosen scope.
   */
  readonly scope: Signal<FindScope>;

  /**
   * Gets whether the chosen scope searches and replaces the files on disk rather than open editors.
   */
  readonly onDisk: Signal<boolean>;

  /**
   * Chooses the scope, clearing what the last one found. The caller searches again.
   * @param scope The scope.
   */
  setScope(scope: FindScope): void;

  /**
   * Gets the absolute path of the active match's file, or null when no match is active.
   * @returns Returns the path, or null.
   */
  activePath(): string | null;

  /**
   * Gets the absolute paths of the files with matches, in the order they were found.
   * @returns Returns the paths.
   */
  paths(): readonly string[];

  /**
   * Gets whether the active match can be replaced: it is not in a read-only editor.
   * @returns Returns true when Replace can change it.
   */
  activeReplaceable(): boolean;

  /**
   * Gets whether Replace All has anything to change: any match outside a read-only editor.
   * @returns Returns true when there is a replaceable match.
   */
  hasReplaceable(): boolean;

  /**
   * Replaces the active match and moves to the next.
   * @param replacement The text to replace it with.
   * @returns Returns what was replaced, or null when there was no active match.
   */
  replaceMatch(replacement: string): SearchReplaceOutcome | Promise<SearchReplaceOutcome>;

  /**
   * Replaces every match in the files listed, but for those skipped.
   * @param replacement The text to replace each match with.
   * @param skip The absolute paths of files to leave alone on disk.
   * @returns Returns what was replaced, or null when there was nothing to replace.
   */
  replaceFiles(
    replacement: string,
    skip: ReadonlySet<string>,
  ): SearchReplaceOutcome | Promise<SearchReplaceOutcome>;
}
