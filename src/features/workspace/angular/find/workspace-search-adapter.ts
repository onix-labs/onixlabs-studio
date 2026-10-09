import { signal, Signal, WritableSignal } from '@angular/core';
import {
  FindAdapter,
  FindQuery,
  FindResultItem,
} from '@shared/angular/components/find-panel/find-adapter';
import { Editors, EditorLocation } from '@shared/angular/services/editors/editors';
import { FileOpener } from '@shared/angular/services/file-opener/file-opener';
import { Search } from '@shared/angular/services/search/search';
import {
  ReplaceRequest,
  ReplaceResponse,
  SearchMatch,
  SearchResponse,
  SearchResultFile,
} from '@shared/api/search-channels';

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
 * by file, and opens a selected match by opening its file and revealing the matched line.
 *
 * Replace (#882) writes the files on disk through the main process — one match ({@link replaceMatch})
 * or every match in the listed files ({@link replaceFiles}) — and then searches again, so the list
 * shows what is left. There is no undo: the files are changed on disk, as a save would change them.
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
   * Holds the query and root of the last search asked for, or null before any — what a replace
   * replaces, and what it searches again afterwards.
   */
  private last: { readonly query: FindQuery; readonly root: string } | null = null;

  /**
   * Gets the match list.
   */
  public readonly matches: Signal<readonly FindResultItem[]> = this.matchesState.asReadonly();

  /**
   * Gets the zero-based index of the active match, or -1 when there is none.
   */
  public readonly activeIndex: Signal<number> = this.activeIndexState.asReadonly();

  /**
   * Gets a value indicating that workspace search supports replace.
   */
  public readonly supportsReplace: boolean = true;

  /**
   * Gets a value indicating that there is nothing to undo: a replace writes the files on disk.
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
      this.last = null;
      this.reset();
      return;
    }
    this.last = { query, root };
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
   * Replaces the active match.
   * @param replacement The text to replace it with.
   */
  public replace(replacement: string): void {
    void this.replaceMatch(replacement);
  }

  /**
   * Replaces every match.
   * @param replacement The text to replace each match with.
   */
  public replaceAll(replacement: string): void {
    void this.replaceFiles(replacement, new Set<string>());
  }

  /**
   * No-op: a replace writes the files on disk, so there is no in-panel history to undo.
   */
  public undo(): void {
    // Intentionally empty; the files' own history (source control) is the undo.
  }

  /**
   * Gets the absolute path of the active match's file, or null when no match is active.
   * @returns Returns the path, or null.
   */
  public activePath(): string | null {
    return this.flat[this.activeIndexState()]?.path ?? null;
  }

  /**
   * Gets the absolute paths of the files with matches, in the order they were found.
   * @returns Returns the paths.
   */
  public paths(): readonly string[] {
    return [...new Set<string>(this.flat.map((entry: FlatMatch): string => entry.path))];
  }

  /**
   * Replaces the active match in its file on disk, searches again, and selects the match that now
   * takes its place in the list — so pressing Replace again moves on through the matches.
   * @param replacement The text to replace the match with.
   * @returns Returns what was replaced, or null when there was no active match to replace.
   */
  public async replaceMatch(replacement: string): Promise<ReplaceResponse | null> {
    const index: number = this.activeIndexState();
    const match: FlatMatch | undefined = this.flat[index];
    if (match === undefined || this.last === null) {
      return null;
    }
    const response: ReplaceResponse = await this.search.replace({
      ...this.requestFor(this.last.query, this.last.root, replacement),
      files: [],
      target: { path: match.path, line: match.item.line, column: match.item.column },
    });
    await this.refresh();
    if (this.flat.length > 0) {
      this.select(Math.min(index, this.flat.length - 1));
    }
    return response;
  }

  /**
   * Replaces every match in the files with matches, but for those skipped, then searches again.
   * @param replacement The text to replace each match with.
   * @param skip The absolute paths of files to leave alone.
   * @returns Returns what was replaced, or null when there was nothing to replace.
   */
  public async replaceFiles(
    replacement: string,
    skip: ReadonlySet<string>,
  ): Promise<ReplaceResponse | null> {
    const files: readonly string[] = this.paths().filter(
      (path: string): boolean => !skip.has(path),
    );
    if (files.length === 0 || this.last === null) {
      return null;
    }
    const response: ReplaceResponse = await this.search.replace({
      ...this.requestFor(this.last.query, this.last.root, replacement),
      files,
    });
    await this.refresh();
    return response;
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
    this.last = null;
    this.reset();
  }

  /**
   * Searches again for the last query at once, cancelling any search still waiting to run.
   */
  private async refresh(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.last !== null) {
      await this.execute(this.last.query, this.last.root, ++this.sequence);
    }
  }

  /**
   * Builds the part of a replace request the query decides.
   * @param query The query.
   * @param root The workspace root.
   * @param replacement The replacement.
   * @returns Returns the request's query fields.
   */
  private requestFor(
    query: FindQuery,
    root: string,
    replacement: string,
  ): Omit<ReplaceRequest, 'files' | 'target'> {
    return {
      query: query.text,
      root,
      caseSensitive: query.caseSensitive,
      wholeWord: query.wholeWord,
      regexp: query.regexp,
      replacement,
    };
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
      file.matches.map((match: SearchMatch): FlatMatch => ({
        path: file.path,
        item: {
          line: match.line,
          column: match.column,
          before: match.before,
          text: match.text,
          after: match.after,
          file: file.relativePath,
        },
      })),
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
