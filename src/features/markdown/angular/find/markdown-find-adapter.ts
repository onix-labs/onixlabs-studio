import { signal, Signal, WritableSignal } from '@angular/core';
import type { Command, EditorState } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import {
  findNext,
  findPrev,
  getSearchState,
  replaceAll,
  replaceNext,
  SearchQuery,
  setSearchState,
} from 'prosemirror-search';
import { FindAdapter, FindQuery } from '@shared/angular/components/find-panel/find-adapter';

/**
 * Guards the match-counting scan against a pathological non-advancing query, capping the number of
 * matches counted in one document.
 */
const MAX_MATCHES: number = 100000;

/**
 * Describes a single match returned by {@link SearchQuery.findNext}.
 */
interface MatchRange {
  /**
   * Gets the document position where the match begins.
   */
  readonly from: number;

  /**
   * Gets the document position where the match ends.
   */
  readonly to: number;
}

/**
 * Drives find-and-replace over the markdown editor's ProseMirror document for the shared find panel,
 * using the `prosemirror-search` plugin registered on the editor. The active query and its match
 * highlights live in the plugin's state; this adapter sets the query and issues the navigation and
 * replacement commands through the editor view, and reports the reactive match totals the panel shows.
 */
export class MarkdownFindAdapter implements FindAdapter {
  /**
   * Holds the total number of matches for the active query.
   */
  private readonly matchCountState: WritableSignal<number> = signal<number>(0);

  /**
   * Holds the one-based index of the match at the current selection, or zero when none.
   */
  private readonly activeMatchState: WritableSignal<number> = signal<number>(0);

  /**
   * Holds the most recent find query, so a replace can reissue it carrying the replacement text.
   */
  private lastQuery: FindQuery | null = null;

  /**
   * Gets the total number of matches for the active query.
   */
  public readonly matchCount: Signal<number> = this.matchCountState.asReadonly();

  /**
   * Gets the one-based index of the active match, or zero when there is none.
   */
  public readonly activeMatch: Signal<number> = this.activeMatchState.asReadonly();

  /**
   * Initializes a new instance of the {@link MarkdownFindAdapter} class.
   * @param viewOf Resolves the current ProseMirror editor view, or null before it is ready.
   */
  public constructor(private readonly viewOf: () => EditorView | null) {}

  /**
   * Applies a find query, highlighting its matches and refreshing the totals.
   * @param query The query to search for.
   */
  public setQuery(query: FindQuery): void {
    this.lastQuery = query;
    this.applyQuery(query, '');
    this.refresh();
  }

  /**
   * Moves to and reveals the next match.
   */
  public next(): void {
    this.dispatchCommand(findNext);
  }

  /**
   * Moves to and reveals the previous match.
   */
  public previous(): void {
    this.dispatchCommand(findPrev);
  }

  /**
   * Replaces the active match with the replacement text, then advances to the next match.
   * @param replacement The text to replace the active match with.
   */
  public replace(replacement: string): void {
    if (this.lastQuery === null) {
      return;
    }
    this.applyQuery(this.lastQuery, replacement);
    this.dispatchCommand(replaceNext);
  }

  /**
   * Replaces every match with the replacement text.
   * @param replacement The text to replace each match with.
   */
  public replaceAll(replacement: string): void {
    if (this.lastQuery === null) {
      return;
    }
    this.applyQuery(this.lastQuery, replacement);
    this.dispatchCommand(replaceAll);
  }

  /**
   * Clears the active query and removes its highlights.
   */
  public clear(): void {
    this.lastQuery = null;
    const view: EditorView | null = this.viewOf();
    if (view !== null) {
      view.dispatch(setSearchState(view.state.tr, new SearchQuery({ search: '' })));
    }
    this.matchCountState.set(0);
    this.activeMatchState.set(0);
  }

  /**
   * Sets the active search query on the editor, carrying the given replacement text.
   * @param query The find query.
   * @param replacement The replacement text (empty for a find-only query).
   */
  private applyQuery(query: FindQuery, replacement: string): void {
    const view: EditorView | null = this.viewOf();
    if (view === null) {
      return;
    }
    const searchQuery: SearchQuery = new SearchQuery({
      search: query.text,
      caseSensitive: query.caseSensitive,
      wholeWord: query.wholeWord,
      regexp: query.regexp,
      replace: replacement,
    });
    view.dispatch(setSearchState(view.state.tr, searchQuery));
  }

  /**
   * Runs a search command against the editor, then refreshes the totals.
   * @param command The prosemirror-search command to run.
   */
  private dispatchCommand(command: Command): void {
    const view: EditorView | null = this.viewOf();
    if (view === null) {
      return;
    }
    command(view.state, view.dispatch, view);
    this.refresh();
  }

  /**
   * Recomputes the match total and the active match index from the editor's current search state.
   */
  private refresh(): void {
    const view: EditorView | null = this.viewOf();
    if (view === null) {
      this.matchCountState.set(0);
      this.activeMatchState.set(0);
      return;
    }
    const state: EditorState = view.state;
    const query: SearchQuery | undefined = getSearchState(state)?.query;
    if (query === undefined) {
      this.matchCountState.set(0);
      this.activeMatchState.set(0);
      return;
    }
    if (!query.valid) {
      this.matchCountState.set(0);
      this.activeMatchState.set(0);
      return;
    }

    const selectionFrom: number = state.selection.from;
    const selectionTo: number = state.selection.to;
    let count: number = 0;
    let active: number = 0;
    let cursor: number = 0;
    for (let scanned: number = 0; scanned < MAX_MATCHES; scanned++) {
      const match: MatchRange | null = query.findNext(state, cursor);
      if (match === null || match.from < cursor) {
        break;
      }
      count++;
      if (match.from === selectionFrom && match.to === selectionTo) {
        active = count;
      }
      // Advance past this match; guard against a zero-width match not advancing the cursor.
      cursor = match.to > match.from ? match.to : match.from + 1;
    }
    this.matchCountState.set(count);
    this.activeMatchState.set(active);
  }
}
