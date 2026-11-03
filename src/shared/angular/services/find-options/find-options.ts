import { Service, signal, WritableSignal } from '@angular/core';

/**
 * Holds one surface's find options: case sensitivity, whole words, and regular expressions.
 */
export interface FindOptionSet {
  /**
   * Gets whether the search is case-sensitive.
   */
  readonly caseSensitive: WritableSignal<boolean>;

  /**
   * Gets whether the search matches whole words only.
   */
  readonly wholeWord: WritableSignal<boolean>;

  /**
   * Gets whether the find text is a regular expression.
   */
  readonly regexp: WritableSignal<boolean>;
}

/**
 * Builds a set of find options, all off.
 * @returns Returns the set.
 */
function optionSet(): FindOptionSet {
  return {
    caseSensitive: signal<boolean>(false),
    wholeWord: signal<boolean>(false),
    regexp: signal<boolean>(false),
  };
}

/**
 * Remembers the find options for the session, so a find panel or search view opened again starts
 * with the choices last made rather than all off. The in-file find panel and the workspace search
 * keep their own: a regular expression for a project-wide search is not what a quick find in one
 * file wants. Not persisted — a fresh launch starts all off.
 */
@Service()
export class FindOptions {
  /**
   * Gets the options of the find panel that searches one document.
   */
  public readonly panel: FindOptionSet = optionSet();

  /**
   * Gets the options of the search view that searches a workspace.
   */
  public readonly search: FindOptionSet = optionSet();
}
