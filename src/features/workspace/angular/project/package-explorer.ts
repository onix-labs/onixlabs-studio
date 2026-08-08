import { effect, inject, Service, signal, Signal, WritableSignal } from '@angular/core';
import { Bridge } from '@shared/api/bridge';
import { PackageChannel } from '@shared/api/package-channels';
import {
  PackageSearchItem,
  PackageSearchResult,
  PackageSourceInfo,
} from '@shared/api/package-management';
import { Workspace } from '@shared/angular/services/workspace/workspace';

/**
 * How many results are fetched per page.
 */
const PAGE_SIZE: number = 50;

/**
 * How long, in milliseconds, search-query keystrokes are debounced before a query runs.
 */
const QUERY_DEBOUNCE_MS: number = 300;

/**
 * Drives this tab's package exploration: the sources available to browse, the current source, query
 * and prerelease filter, and the paged results the Explore view renders. Browsing (an empty query) or
 * searching a source resolves and pages through its registry in the main process; credentials never
 * reach here. Sources are loaded lazily the first time exploration is opened. Provided per directory
 * tab. Outside Electron the bridge is absent and everything stays empty.
 */
@Service()
export class PackageExplorer {
  /**
   * Holds this tab's workspace, whose root the sources and searches are scoped to.
   */
  private readonly workspace: Workspace = inject(Workspace);

  /**
   * Holds the generic transport, or undefined when running outside Electron.
   */
  private readonly bridge: Bridge | undefined = window.bridge;

  /**
   * Holds the sources available to browse for the current root.
   */
  private readonly sourcesSignal: WritableSignal<readonly PackageSourceInfo[]> = signal<
    readonly PackageSourceInfo[]
  >([]);

  /**
   * Holds the selected source name, or null when none is chosen yet.
   */
  private readonly selectedSourceSignal: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Holds the active query text.
   */
  private readonly querySignal: WritableSignal<string> = signal<string>('');

  /**
   * Holds whether prerelease versions are included.
   */
  private readonly prereleaseSignal: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds the accumulated results across the pages loaded so far.
   */
  private readonly resultsSignal: WritableSignal<readonly PackageSearchItem[]> = signal<
    readonly PackageSearchItem[]
  >([]);

  /**
   * Holds whether a query or page load is in flight.
   */
  private readonly loadingSignal: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds whether more results are available beyond what has been loaded.
   */
  private readonly hasMoreSignal: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds the total number of matches the source reported for the current query.
   */
  private readonly totalSignal: WritableSignal<number> = signal<number>(0);

  /**
   * Holds whether the sources have been requested for the current root, so they load once on demand.
   */
  private sourcesLoaded: boolean = false;

  /**
   * Holds the pending debounced query timer, or null when none is scheduled.
   */
  private queryTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Holds the generation of the current query, so a stale page (the query changed while it was in
   * flight) does not apply.
   */
  private generation: number = 0;

  /**
   * Gets the sources available to browse.
   */
  public readonly sources: Signal<readonly PackageSourceInfo[]> = this.sourcesSignal.asReadonly();

  /**
   * Gets the selected source name, or null.
   */
  public readonly selectedSource: Signal<string | null> = this.selectedSourceSignal.asReadonly();

  /**
   * Gets the active query text.
   */
  public readonly query: Signal<string> = this.querySignal.asReadonly();

  /**
   * Gets whether prerelease versions are included.
   */
  public readonly prerelease: Signal<boolean> = this.prereleaseSignal.asReadonly();

  /**
   * Gets the accumulated results loaded so far.
   */
  public readonly results: Signal<readonly PackageSearchItem[]> = this.resultsSignal.asReadonly();

  /**
   * Gets whether a query or page load is in flight.
   */
  public readonly loading: Signal<boolean> = this.loadingSignal.asReadonly();

  /**
   * Gets whether more results can be loaded.
   */
  public readonly hasMore: Signal<boolean> = this.hasMoreSignal.asReadonly();

  /**
   * Gets the total number of matches reported for the current query.
   */
  public readonly total: Signal<number> = this.totalSignal.asReadonly();

  /**
   * Initializes a new instance of the {@link PackageExplorer} class, resetting exploration whenever the
   * open root changes (its sources are reloaded the next time exploration is opened).
   */
  public constructor() {
    effect((): void => {
      this.workspace.root();
      this.reset();
    });
  }

  /**
   * Loads the browseable sources for the current root once, then runs the initial (browse) query. A
   * no-op when already loaded, so opening the Explore view repeatedly is cheap.
   */
  public async ensureSources(): Promise<void> {
    if (this.sourcesLoaded) {
      return;
    }
    this.sourcesLoaded = true;
    const root: string | null = this.workspace.root()?.path ?? null;
    if (this.bridge === undefined || root === null) {
      return;
    }
    const sources: readonly PackageSourceInfo[] = await this.bridge.invoke<
      readonly PackageSourceInfo[]
    >(PackageChannel.Sources, root);
    this.sourcesSignal.set(sources);
    if (sources.length > 0) {
      this.selectedSourceSignal.set(sources[0].name);
      this.runQuery();
    }
  }

  /**
   * Selects the source to browse, resetting and re-running the query against it.
   * @param name The source name.
   */
  public selectSource(name: string): void {
    this.selectedSourceSignal.set(name);
    this.runQuery();
  }

  /**
   * Sets the query text, debounced, so a fast typist does not fire a request per keystroke.
   * @param value The query text.
   */
  public setQuery(value: string): void {
    this.querySignal.set(value);
    if (this.queryTimer !== null) {
      clearTimeout(this.queryTimer);
    }
    this.queryTimer = setTimeout((): void => {
      this.queryTimer = null;
      this.runQuery();
    }, QUERY_DEBOUNCE_MS);
  }

  /**
   * Sets whether prerelease versions are included, re-running the query.
   * @param value Whether to include prereleases.
   */
  public setPrerelease(value: boolean): void {
    this.prereleaseSignal.set(value);
    this.runQuery();
  }

  /**
   * Loads the next page of results for the current query, appending them.
   */
  public loadMore(): void {
    if (!this.hasMoreSignal() || this.loadingSignal()) {
      return;
    }
    void this.fetchPage(this.resultsSignal().length, this.generation);
  }

  /**
   * Runs the current query from the first page, replacing any existing results.
   */
  private runQuery(): void {
    this.generation += 1;
    this.resultsSignal.set([]);
    this.totalSignal.set(0);
    this.hasMoreSignal.set(false);
    void this.fetchPage(0, this.generation);
  }

  /**
   * Fetches one page of results and applies it (replacing at offset 0, appending otherwise), unless the
   * query generation has been superseded.
   * @param skip The offset to fetch from.
   * @param generation The query generation this fetch belongs to.
   * @returns Returns a promise that resolves once the page has settled.
   */
  private async fetchPage(skip: number, generation: number): Promise<void> {
    const root: string | null = this.workspace.root()?.path ?? null;
    const source: string | null = this.selectedSourceSignal();
    if (this.bridge === undefined || root === null || source === null) {
      return;
    }
    this.loadingSignal.set(true);
    const result: PackageSearchResult = await this.bridge.invoke<PackageSearchResult>(
      PackageChannel.Search,
      root,
      source,
      this.querySignal().trim(),
      { skip, take: PAGE_SIZE, prerelease: this.prereleaseSignal() },
    );
    if (generation !== this.generation) {
      return;
    }
    this.resultsSignal.update((current: readonly PackageSearchItem[]): readonly PackageSearchItem[] =>
      skip === 0 ? result.items : [...current, ...result.items],
    );
    this.totalSignal.set(result.total);
    this.hasMoreSignal.set(result.hasMore);
    this.loadingSignal.set(false);
  }

  /**
   * Resets all exploration state, so a new root starts clean and reloads its sources on demand.
   */
  private reset(): void {
    if (this.queryTimer !== null) {
      clearTimeout(this.queryTimer);
      this.queryTimer = null;
    }
    this.generation += 1;
    this.sourcesLoaded = false;
    this.sourcesSignal.set([]);
    this.selectedSourceSignal.set(null);
    this.querySignal.set('');
    this.prereleaseSignal.set(false);
    this.resultsSignal.set([]);
    this.totalSignal.set(0);
    this.hasMoreSignal.set(false);
    this.loadingSignal.set(false);
  }
}
