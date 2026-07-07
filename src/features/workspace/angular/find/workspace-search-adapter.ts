import { signal, Signal, WritableSignal } from '@angular/core';
import {
  FindQuery,
  FindResultFile,
  FindResultMatch,
  WorkspaceFindAdapter,
} from '@shared/angular/components/find-panel/find-adapter';
import { Editors, EditorLocation } from '@shared/angular/services/editors/editors';
import { FileOpener } from '@shared/angular/services/file-opener/file-opener';
import { Search } from '@shared/angular/services/search/search';
import { SearchResponse, SearchResultFile } from '@shared/api/search-channels';

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
 * Represents a single match flattened out of the grouped results, for next/previous navigation.
 */
interface FlatMatch {
  /**
   * Gets the file the match belongs to.
   */
  readonly file: FindResultFile;

  /**
   * Gets the match.
   */
  readonly match: FindResultMatch;
}

/**
 * Drives workspace-wide find for the shared find panel. It runs a debounced search over the active
 * workspace root through the main-process search manager, exposes the matches grouped by file for the
 * results tree, and opens a match by opening its file and revealing the matched line. Replace across
 * files is not yet supported, so the replace operations are inert and the panel hides the replace
 * affordances for this adapter.
 */
export class WorkspaceSearchAdapter implements WorkspaceFindAdapter {
  /**
   * Holds the total number of matches across every file.
   */
  private readonly matchCountState: WritableSignal<number> = signal<number>(0);

  /**
   * Holds the one-based index of the active match, or zero when none.
   */
  private readonly activeMatchState: WritableSignal<number> = signal<number>(0);

  /**
   * Holds the results grouped by file.
   */
  private readonly resultsState: WritableSignal<readonly FindResultFile[]> = signal<
    readonly FindResultFile[]
  >([]);

  /**
   * Holds a value indicating whether a search is running.
   */
  private readonly searchingState: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds the flattened match list backing next/previous navigation.
   */
  private flat: readonly FlatMatch[] = [];

  /**
   * Holds the zero-based index of the active match within {@link flat}, or -1 when none is active.
   */
  private activeIndex: number = -1;

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
   * Gets the total number of matches across every file.
   */
  public readonly matchCount: Signal<number> = this.matchCountState.asReadonly();

  /**
   * Gets the one-based index of the active match, or zero when there is none.
   */
  public readonly activeMatch: Signal<number> = this.activeMatchState.asReadonly();

  /**
   * Gets the results grouped by file.
   */
  public readonly results: Signal<readonly FindResultFile[]> = this.resultsState.asReadonly();

  /**
   * Gets a value indicating whether a search is running.
   */
  public readonly searching: Signal<boolean> = this.searchingState.asReadonly();

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
    if (query.text.length === 0) {
      this.reset();
      return;
    }
    const root: string | null = this.rootOf();
    if (root === null) {
      this.reset();
      return;
    }
    this.searchingState.set(true);
    const token: number = ++this.sequence;
    this.timer = setTimeout((): void => {
      void this.execute(query, root, token);
    }, SEARCH_DEBOUNCE_MS);
  }

  /**
   * Moves to and opens the next match, wrapping past the end.
   */
  public next(): void {
    this.step(1);
  }

  /**
   * Moves to and opens the previous match, wrapping before the start.
   */
  public previous(): void {
    this.step(-1);
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
   * Opens a match in its editor and reveals the matched line.
   * @param file The file the match belongs to.
   * @param match The match to reveal.
   */
  public openMatch(file: FindResultFile, match: FindResultMatch): void {
    void this.openAndReveal(file, match);
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
    const files: readonly FindResultFile[] = response.files.map(
      (file: SearchResultFile): FindResultFile => ({
        path: file.path,
        relativePath: file.relativePath,
        matches: file.matches.map(
          (match): FindResultMatch => ({
            line: match.line,
            column: match.column,
            preview: match.preview,
          }),
        ),
      }),
    );
    this.resultsState.set(files);
    this.flat = files.flatMap((file: FindResultFile): FlatMatch[] =>
      file.matches.map((match: FindResultMatch): FlatMatch => ({ file, match })),
    );
    this.activeIndex = -1;
    this.matchCountState.set(response.total);
    this.activeMatchState.set(0);
    this.searchingState.set(false);
  }

  /**
   * Advances the active match by the given signed step, wrapping at either end, and opens it.
   * @param delta The number of matches to move by (1 forward, -1 back).
   */
  private step(delta: number): void {
    if (this.flat.length === 0) {
      return;
    }
    const count: number = this.flat.length;
    this.activeIndex = (this.activeIndex + delta + count) % count;
    this.activeMatchState.set(this.activeIndex + 1);
    const target: FlatMatch = this.flat[this.activeIndex];
    void this.openAndReveal(target.file, target.match);
  }

  /**
   * Opens a match's file and reveals its line once the editor has registered.
   * @param file The file to open.
   * @param match The match to reveal.
   */
  private async openAndReveal(file: FindResultFile, match: FindResultMatch): Promise<void> {
    await this.fileOpener.openPath(file.path);
    for (let attempt: number = 0; attempt < REVEAL_POLL_ATTEMPTS; attempt++) {
      const modelUri: string | undefined = this.editors.modelUriForPath(file.path);
      if (modelUri !== undefined) {
        const location: EditorLocation | undefined = this.editors.locate(modelUri);
        if (location !== undefined) {
          this.editors.requestReveal(location.documentId, match.line, match.column);
          return;
        }
      }
      await this.delay(REVEAL_POLL_MS);
    }
  }

  /**
   * Resets the results, counts, and navigation state.
   */
  private reset(): void {
    this.flat = [];
    this.activeIndex = -1;
    this.resultsState.set([]);
    this.matchCountState.set(0);
    this.activeMatchState.set(0);
    this.searchingState.set(false);
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
