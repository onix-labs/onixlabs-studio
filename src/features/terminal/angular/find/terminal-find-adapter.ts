import { signal, Signal, WritableSignal } from '@angular/core';
import { ISearchOptions } from '@xterm/addon-search';
import { Terminal } from '@shared/angular/components/terminal/terminal';
import {
  FindAdapter,
  FindQuery,
  FindResultItem,
} from '@shared/angular/components/find-panel/find-adapter';

/**
 * Caps the length of each side of a match's line preview, so a long line does not bloat a row.
 */
const PREVIEW_SIDE: number = 40;

/**
 * Holds the decoration colours the search addon paints matches with. The addon requires opaque
 * `#RRGGBB` values (no alpha); inactive matches use a muted slate and the active match an amber
 * consistent with the terminal's find emphasis elsewhere.
 */
const DECORATIONS: ISearchOptions['decorations'] = {
  matchBackground: '#515c6a',
  matchBorder: '#515c6a',
  matchOverviewRuler: '#a0a0a0',
  activeMatchBackground: '#e6b450',
  activeMatchBorder: '#e6b450',
  activeMatchColorOverviewRuler: '#e6b450',
};

/**
 * Drives find over a terminal pane for the shared find panel. The pane's search addon owns the
 * on-screen highlighting and match navigation across the whole buffer (including scrollback); this
 * adapter mirrors that match set into the panel's results list by scanning the buffer's logical lines,
 * and keeps the panel's active-match indicator in step with the addon.
 *
 * A terminal buffer is read-only output, so replace is unsupported: {@link supportsReplace} is false
 * (which makes the panel hide its replace affordances) and the replace operations are inert.
 */
export class TerminalFindAdapter implements FindAdapter {
  /**
   * Holds the match list shown by the panel.
   */
  private readonly matchesState: WritableSignal<readonly FindResultItem[]> = signal<
    readonly FindResultItem[]
  >([]);

  /**
   * Holds the zero-based index of the active match, or -1 when none. Driven by the addon's results.
   */
  private readonly activeIndexState: WritableSignal<number> = signal<number>(-1);

  /**
   * Holds the most recent query, so navigation can re-issue it against the addon.
   */
  private lastQuery: FindQuery | null = null;

  /**
   * Holds the function that removes the addon results listener, or null when not subscribed.
   */
  private unbind: (() => void) | null = null;

  /**
   * Gets the match list.
   */
  public readonly matches: Signal<readonly FindResultItem[]> = this.matchesState.asReadonly();

  /**
   * Gets the zero-based index of the active match, or -1 when there is none.
   */
  public readonly activeIndex: Signal<number> = this.activeIndexState.asReadonly();

  /**
   * Gets a value indicating that a terminal buffer does not support replace.
   */
  public readonly supportsReplace: boolean = false;

  /**
   * Gets a value indicating that there is never anything to undo (replace is unsupported).
   */
  public readonly canUndo: Signal<boolean> = signal<boolean>(false).asReadonly();

  /**
   * Initializes a new instance of the {@link TerminalFindAdapter} class.
   * @param paneOf Resolves the current terminal pane, or null before it is ready.
   */
  public constructor(private readonly paneOf: () => Terminal | null) {}

  /**
   * Applies a find query, rebuilding the match list and repainting the addon's highlights. An empty
   * query — or an invalid pattern — clears the matches.
   * @param query The query to search for.
   */
  public setQuery(query: FindQuery): void {
    this.lastQuery = query;
    this.activeIndexState.set(-1);
    const pane: Terminal | null = this.paneOf();
    if (pane === null) {
      this.matchesState.set([]);
      return;
    }
    this.bindResults(pane);

    if (query.text.length === 0) {
      pane.clearSearch();
      this.matchesState.set([]);
      return;
    }

    const items: readonly FindResultItem[] | null = this.buildMatches(pane.bufferLines(), query);
    if (items === null) {
      pane.clearSearch();
      this.matchesState.set([]);
      return;
    }
    this.matchesState.set(items);
    if (items.length > 0) {
      pane.searchNext(query.text, this.optionsFor(query));
    } else {
      pane.clearSearch();
    }
  }

  /**
   * Selects and reveals the match at the given index by stepping the addon from the active match.
   * @param index The zero-based index of the match to select.
   */
  public select(index: number): void {
    const pane: Terminal | null = this.paneOf();
    const query: FindQuery | null = this.lastQuery;
    if (pane === null || query === null || index < 0 || index >= this.matchesState().length) {
      return;
    }
    const options: ISearchOptions = this.optionsFor(query);
    if (this.activeIndexState() === -1) {
      pane.searchNext(query.text, options);
    }
    const delta: number = index - this.activeIndexState();
    for (let step: number = 0; step < Math.abs(delta); step++) {
      if (delta > 0) {
        pane.searchNext(query.text, options);
      } else {
        pane.searchPrevious(query.text, options);
      }
    }
  }

  /**
   * Selects the next match, stopping at the last.
   */
  public next(): void {
    const index: number = this.activeIndexState() + 1;
    if (index <= this.matchesState().length - 1) {
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
   * Does nothing: a terminal buffer is read-only, so there is no replace. The panel never invokes this
   * because {@link supportsReplace} is false.
   */
  public replace(): void {
    return;
  }

  /**
   * Does nothing: a terminal buffer is read-only, so there is no replace. The panel never invokes this
   * because {@link supportsReplace} is false.
   */
  public replaceAll(): void {
    return;
  }

  /**
   * Does nothing: a terminal buffer is read-only, so there is nothing to undo. The panel never invokes
   * this because {@link supportsReplace} is false.
   */
  public undo(): void {
    return;
  }

  /**
   * Clears the active query and removes the addon's highlights.
   */
  public clear(): void {
    this.lastQuery = null;
    this.activeIndexState.set(-1);
    this.matchesState.set([]);
    this.paneOf()?.clearSearch();
    this.unbind?.();
    this.unbind = null;
  }

  /**
   * Subscribes to the pane's search results so the active-match index tracks the addon, replacing any
   * previous subscription.
   * @param pane The terminal pane to observe.
   */
  private bindResults(pane: Terminal): void {
    this.unbind?.();
    this.unbind = pane.onSearchResults((activeIndex: number): void =>
      this.activeIndexState.set(activeIndex),
    );
  }

  /**
   * Builds the search addon options from a query.
   * @param query The query to translate.
   * @returns Returns the addon search options.
   */
  private optionsFor(query: FindQuery): ISearchOptions {
    return {
      regex: query.regexp,
      wholeWord: query.wholeWord,
      caseSensitive: query.caseSensitive,
      decorations: DECORATIONS,
    };
  }

  /**
   * Scans the buffer's logical lines for the query, building the panel's result list with a preview of
   * each match's surrounding text.
   * @param lines The buffer's logical lines.
   * @param query The query to search for.
   * @returns Returns the matches in buffer order, or null when the query is an invalid pattern.
   */
  private buildMatches(
    lines: readonly string[],
    query: FindQuery,
  ): readonly FindResultItem[] | null {
    let regex: RegExp;
    try {
      regex = this.toRegExp(query);
    } catch {
      return null;
    }
    const items: FindResultItem[] = [];
    lines.forEach((lineText: string, index: number): void => {
      regex.lastIndex = 0;
      let match: RegExpExecArray | null = regex.exec(lineText);
      while (match !== null) {
        const start: number = match.index;
        const text: string = match[0];
        if (text.length === 0) {
          regex.lastIndex = start + 1;
          match = regex.exec(lineText);
          continue;
        }
        items.push({
          line: index + 1,
          column: start + 1,
          before: lineText.slice(Math.max(0, start - PREVIEW_SIDE), start),
          text,
          after: lineText.slice(start + text.length, start + text.length + PREVIEW_SIDE),
        });
        match = regex.exec(lineText);
      }
    });
    return items;
  }

  /**
   * Compiles a query into a global regular expression, escaping literal text and applying the
   * whole-word and case-sensitivity options.
   * @param query The query to compile.
   * @returns Returns the compiled expression.
   */
  private toRegExp(query: FindQuery): RegExp {
    const body: string = query.regexp
      ? query.text
      : query.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const source: string = query.wholeWord ? `\\b(?:${body})\\b` : body;
    return new RegExp(source, `g${query.caseSensitive ? '' : 'i'}`);
  }
}
