import { signal, Signal, WritableSignal } from '@angular/core';
import { undo } from '@milkdown/kit/prose/history';
import type { EditorState } from '@milkdown/kit/prose/state';
import { TextSelection } from '@milkdown/kit/prose/state';
import type { ResolvedPos } from '@milkdown/kit/prose/model';
import type { EditorView } from '@milkdown/kit/prose/view';
import {
  getSearchState,
  replaceAll,
  replaceNext,
  SearchQuery,
  setSearchState,
} from 'prosemirror-search';
import {
  FindAdapter,
  FindQuery,
  FindResultItem,
} from '@shared/angular/components/find-panel/find-adapter';

/**
 * Guards the match-collecting scan against a pathological non-advancing query, capping the number of
 * matches gathered in one document.
 */
const MAX_MATCHES: number = 100000;

/**
 * Caps the length of each side of a match's block preview, so a long paragraph does not bloat a row.
 */
const PREVIEW_SIDE: number = 40;

/**
 * Describes a single match range in the document.
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
 * using the `prosemirror-search` plugin registered on the editor. It collects the matches for the
 * active query into the panel's list (with a block-relative position and a preview), moves the
 * selection to a chosen match, replaces through the plugin's commands, and undoes through the editor's
 * history. Because the plugin recomputes matches on every document change, replaced matches drop out of
 * the list on the next scan rather than lingering greyed.
 */
export class MarkdownFindAdapter implements FindAdapter {
  /**
   * Holds the match list shown by the panel.
   */
  private readonly matchesState: WritableSignal<readonly FindResultItem[]> = signal<
    readonly FindResultItem[]
  >([]);

  /**
   * Holds the zero-based index of the active match, or -1 when none.
   */
  private readonly activeIndexState: WritableSignal<number> = signal<number>(-1);

  /**
   * Holds whether the last replace can be undone.
   */
  private readonly canUndoState: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds the match ranges, parallel to the match list.
   */
  private ranges: readonly MatchRange[] = [];

  /**
   * Holds the most recent find query, so a replace can reissue it carrying the replacement text.
   */
  private lastQuery: FindQuery | null = null;

  /**
   * Gets the match list.
   */
  public readonly matches: Signal<readonly FindResultItem[]> = this.matchesState.asReadonly();

  /**
   * Gets the zero-based index of the active match, or -1 when there is none.
   */
  public readonly activeIndex: Signal<number> = this.activeIndexState.asReadonly();

  /**
   * Gets a value indicating that the markdown editor supports replace.
   */
  public readonly supportsReplace: boolean = true;

  /**
   * Gets whether the last replace can be undone.
   */
  public readonly canUndo: Signal<boolean> = this.canUndoState.asReadonly();

  /**
   * Initializes a new instance of the {@link MarkdownFindAdapter} class.
   * @param viewOf Resolves the current ProseMirror editor view, or null before it is ready.
   */
  public constructor(private readonly viewOf: () => EditorView | null) {}

  /**
   * Applies a find query, highlighting its matches and rebuilding the list.
   * @param query The query to search for.
   */
  public setQuery(query: FindQuery): void {
    this.lastQuery = query;
    this.canUndoState.set(false);
    this.applyQuery(query, '');
    this.scan();
  }

  /**
   * Selects and reveals the match at the given index.
   * @param index The zero-based index of the match to select.
   */
  public select(index: number): void {
    if (index < 0 || index >= this.ranges.length) {
      return;
    }
    const view: EditorView | null = this.viewOf();
    if (view === null) {
      return;
    }
    this.activeIndexState.set(index);
    const range: MatchRange = this.ranges[index];
    const selection: TextSelection = TextSelection.create(view.state.doc, range.from, range.to);
    view.dispatch(view.state.tr.setSelection(selection).scrollIntoView());
    view.focus();
  }

  /**
   * Selects the next match, stopping at the last.
   */
  public next(): void {
    const index: number = this.activeIndexState() + 1;
    if (this.ranges.length > 0 && index <= this.ranges.length - 1) {
      this.select(index);
    }
  }

  /**
   * Selects the previous match, stopping at the first.
   */
  public previous(): void {
    const index: number = this.activeIndexState() - 1;
    if (index >= 0) {
      this.select(index);
    }
  }

  /**
   * Replaces the active match with the replacement text, then advances to the next match.
   * @param replacement The text to replace the active match with.
   */
  public replace(replacement: string): void {
    if (this.lastQuery === null || this.activeIndexState() < 0) {
      return;
    }
    const view: EditorView | null = this.viewOf();
    if (view === null) {
      return;
    }
    this.select(this.activeIndexState());
    this.applyQuery(this.lastQuery, replacement);
    replaceNext(view.state, view.dispatch, view);
    this.canUndoState.set(true);
    this.scan();
    if (this.ranges.length > 0) {
      this.select(Math.min(this.activeIndexState(), this.ranges.length - 1));
    }
  }

  /**
   * Replaces every match with the replacement text.
   * @param replacement The text to replace each match with.
   */
  public replaceAll(replacement: string): void {
    if (this.lastQuery === null) {
      return;
    }
    const view: EditorView | null = this.viewOf();
    if (view === null) {
      return;
    }
    this.applyQuery(this.lastQuery, replacement);
    replaceAll(view.state, view.dispatch, view);
    this.canUndoState.set(true);
    this.scan();
  }

  /**
   * Undoes the most recent replace through the editor's history, then rescans.
   */
  public undo(): void {
    const view: EditorView | null = this.viewOf();
    if (view === null) {
      return;
    }
    undo(view.state, view.dispatch);
    this.canUndoState.set(false);
    this.scan();
  }

  /**
   * Clears the active query and removes its highlights.
   */
  public clear(): void {
    this.lastQuery = null;
    this.canUndoState.set(false);
    const view: EditorView | null = this.viewOf();
    if (view !== null) {
      view.dispatch(setSearchState(view.state.tr, new SearchQuery({ search: '' })));
    }
    this.ranges = [];
    this.matchesState.set([]);
    this.activeIndexState.set(-1);
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
   * Collects the matches for the active query into the list, preserving the active selection's index.
   */
  private scan(): void {
    const view: EditorView | null = this.viewOf();
    const state: EditorState | null = view?.state ?? null;
    const query: SearchQuery | undefined =
      state === null ? undefined : getSearchState(state)?.query;
    if (state === null || !query?.valid) {
      this.ranges = [];
      this.matchesState.set([]);
      this.activeIndexState.set(-1);
      return;
    }
    const ranges: MatchRange[] = [];
    const items: FindResultItem[] = [];
    let cursor: number = 0;
    for (let scanned: number = 0; scanned < MAX_MATCHES; scanned++) {
      const match: MatchRange | null = query.findNext(state, cursor);
      if (match === null || match.from < cursor) {
        break;
      }
      ranges.push(match);
      items.push(this.itemFromRange(state, match));
      cursor = match.to > match.from ? match.to : match.from + 1;
    }
    this.ranges = ranges;
    this.matchesState.set(items);
    const active: number = ranges.findIndex(
      (range: MatchRange): boolean =>
        range.from === state.selection.from && range.to === state.selection.to,
    );
    this.activeIndexState.set(active);
  }

  /**
   * Builds a match item from a range: its block-relative position, matched text, and surrounding block
   * text trimmed to a preview length.
   * @param state The editor state.
   * @param range The match range.
   * @returns Returns the match item.
   */
  private itemFromRange(state: EditorState, range: MatchRange): FindResultItem {
    const resolved: ResolvedPos = state.doc.resolve(range.from);
    const blockText: string = resolved.parent.textContent;
    const offset: number = range.from - resolved.start();
    const text: string = state.doc.textBetween(range.from, range.to);
    const before: string = blockText.slice(Math.max(0, offset - PREVIEW_SIDE), offset);
    const after: string = blockText.slice(
      offset + text.length,
      offset + text.length + PREVIEW_SIDE,
    );
    return {
      line: resolved.index(0) + 1,
      column: offset + 1,
      before,
      text,
      after,
      replaced: false,
    };
  }
}
