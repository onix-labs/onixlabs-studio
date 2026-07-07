import { signal, Signal, WritableSignal } from '@angular/core';
import {
  FindAdapter,
  FindQuery,
  FindResultItem,
} from '@shared/angular/components/find-panel/find-adapter';
import { Editors, EditorLocation } from '@shared/angular/services/editors/editors';
import { FileOpener } from '@shared/angular/services/file-opener/file-opener';
import { Search } from '@shared/angular/services/search/search';
import { SearchMatch, SearchResponse, SearchResultFile } from '@shared/api/search-channels';

/**
 * Debounce applied to the query before a search runs, so typing does not spawn a ripgrep process per
 * keystroke.
 */
const SEARCH_DEBOUNCE_MS: number = 250;

/**
 * Interval between attempts to resolve a just-opened file's document, so a match can be revealed once
 * its editor has registered.
 */
const REVEAL_POLL_MS: number = 80;

/**
 * Number of reveal-resolution attempts before giving up (the file stays open at its start).
 */
const REVEAL_POLL_ATTEMPTS: number = 25;

/**
 * Pairs a flattened match with the file it belongs to, for opening and revealing.
 */
interface FlatMatch {
  /**
   * Gets the absolute path of the file the match belongs to.
   */
  readonly path: string;

  /**
   * Gets the match item.
   */
  readonly item: FindResultItem;
}

/**
 * Drives workspace-wide find for the shared find panel. It runs a debounced search over the active
 * workspace root through the main-process search manager, presents the matches as a flat list labelled
 * by file, and opens a selected match by opening its file and revealing the matched line. It is
 * find-only — replace across files is a follow-up — so it reports {@link supportsReplace} false and the
 * panel hides the replace affordances.
 */
export class WorkspaceSearchAdapter implements FindAdapter {
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
   * Holds the flattened matches, parallel to the match list, carrying each match's file path.
   */
  private flat: readonly FlatMatch[] = [];

  /**
   * Holds the pending debounce timer, or null when none is scheduled.
   */
  private timer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Holds a monotonically increasing token identifying the latest query, so a slow search whose query
   * has since changed can be discarded.
   */
  private sequence: number = 0;

  /**
   * Gets the match list.
   */
  public readonly matches: Signal<readonly FindResultItem[]> = this.matchesState.asReadonly();

  /**
   * Gets the zero-based index of the active match, or -1 when there is none.
   */
  public readonly activeIndex: Signal<number> = this.activeIndexState.asReadonly();

  /**
   * Gets a value indicating that workspace search does not yet support replace.
   */
  public readonly supportsReplace: boolean = false;

  /**
   * Gets a value indicating that there is nothing to undo (find-only surface).
   */
  public readonly canUndo: Signal<boolean> = signal<boolean>(false).asReadonly();

  /**
   * Initializes a new instance of the {@link WorkspaceSearchAdapter} class.
   * @param search The search client that runs the query in the main process.
   * @param fileOpener The file opener used to open a match's file.
   * @param editors The editor registry used to resolve an opened file's document for reveal.
   * @param rootOf Resolves the active workspace root, or null when no folder is open.
   */
  public constructor(
    private readonly search: Search,
    private readonly fileOpener: FileOpener,
    private readonly editors: Editors,
    private readonly rootOf: () => string | null,
  ) {}

  /**
   * Applies a query, running a debounced workspace search. An empty query clears the results.
   * @param query The query to search for.
   */
  public setQuery(query: FindQuery): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const root: string | null = this.rootOf();
    if (query.text.length === 0 || root === null) {
      this.reset();
      return;
    }
    const token: number = ++this.sequence;
    this.timer = setTimeout((): void => {
      void this.execute(query, root, token);
    }, SEARCH_DEBOUNCE_MS);
  }

  /**
   * Selects and opens the match at the given index.
   * @param index The zero-based index of the match to select.
   */
  public select(index: number): void {
    if (index < 0 || index >= this.flat.length) {
      return;
    }
    this.activeIndexState.set(index);
    void this.openAndReveal(this.flat[index]);
  }

  /**
   * Selects and opens the next match, stopping at the last.
   */
  public next(): void {
    const index: number = this.activeIndexState() + 1;
    if (this.flat.length > 0 && index <= this.flat.length - 1) {
      this.select(index);
    }
  }

  /**
   * Selects and opens the previous match, stopping at the first.
   */
  public previous(): void {
    const index: number = this.activeIndexState() - 1;
    if (index >= 0) {
      this.select(index);
    }
  }

  /**
   * No-op: replacing a single match across the workspace is not yet supported.
   */
  public replace(): void {
    // Intentionally empty; workspace replace is a follow-up. The panel hides the affordance.
  }

  /**
   * No-op: replacing across the workspace is not yet supported.
   */
  public replaceAll(): void {
    // Intentionally empty; workspace replace is a follow-up. The panel hides the affordance.
  }

  /**
   * No-op: there is nothing to undo on a find-only surface.
   */
  public undo(): void {
    // Intentionally empty; workspace replace (and so undo) is a follow-up.
  }

  /**
   * Clears the results and cancels any pending search.
   */
  public clear(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.sequence += 1;
    this.reset();
  }

  /**
   * Runs the search and, when it is still the latest, publishes its results.
   * @param query The query to search for.
   * @param root The workspace root to search.
   * @param token The query token identifying this search.
   */
  private async execute(query: FindQuery, root: string, token: number): Promise<void> {
    let response: SearchResponse;
    try {
      response = await this.search.run({
        query: query.text,
        root,
        caseSensitive: query.caseSensitive,
        wholeWord: query.wholeWord,
        regexp: query.regexp,
      });
    } catch {
      response = { files: [], total: 0, capped: false };
    }
    if (token !== this.sequence) {
      return;
    }
    const flat: FlatMatch[] = response.files.flatMap((file: SearchResultFile): FlatMatch[] =>
      file.matches.map(
        (match: SearchMatch): FlatMatch => ({
          path: file.path,
          item: {
            line: match.line,
            column: match.column,
            before: match.before,
            text: match.text,
            after: match.after,
            file: file.relativePath,
          },
        }),
      ),
    );
    this.flat = flat;
    this.matchesState.set(flat.map((entry: FlatMatch): FindResultItem => entry.item));
    this.activeIndexState.set(-1);
  }

  /**
   * Opens a match's file and reveals its line once the editor has registered.
   * @param match The match to open.
   */
  private async openAndReveal(match: FlatMatch): Promise<void> {
    await this.fileOpener.openPath(match.path);
    for (let attempt: number = 0; attempt < REVEAL_POLL_ATTEMPTS; attempt++) {
      const modelUri: string | undefined = this.editors.modelUriForPath(match.path);
      if (modelUri !== undefined) {
        const location: EditorLocation | undefined = this.editors.locate(modelUri);
        if (location !== undefined) {
          this.editors.requestReveal(location.documentId, match.item.line, match.item.column);
          return;
        }
      }
      await this.delay(REVEAL_POLL_MS);
    }
  }

  /**
   * Resets the results and navigation state.
   */
  private reset(): void {
    this.flat = [];
    this.activeIndexState.set(-1);
    this.matchesState.set([]);
  }

  /**
   * Resolves after the given delay.
   * @param ms The delay in milliseconds.
   * @returns Returns a promise that resolves after the delay.
   */
  private delay(ms: number): Promise<void> {
    return new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, ms);
    });
  }
}
