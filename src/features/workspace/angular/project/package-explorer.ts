import { computed, effect, inject, Service, signal, Signal, WritableSignal } from '@angular/core';
import { Bridge } from '@shared/api/bridge';
import { PackageAnswer, PackageChannel, PackageManagerSummary } from '@shared/api/package-channels';
import {
  PackageSearchItem,
  PackageSearchResult,
  PackageSourceInfo,
} from '@shared/api/package-management';
import { Workspace } from '@shared/angular/services/workspace/workspace';
import { Log } from '@shared/angular/services/log/log';
import { PackageModel } from './package-model';

/**
 * Describes a source the Explore view can browse: one of an installed package manager's registries.
 */
export interface ExploreSource {
  /**
   * Gets the key the picker selects it by, unique across package managers.
   */
  readonly key: string;

  /**
   * Gets the source's name, as the plugin names it.
   */
  readonly name: string;

  /**
   * Gets the package manager it belongs to.
   */
  readonly manager: PackageManagerSummary;
}

/**
 * Says how a source answers a query: it lists its packages with none (`browse`), it needs text
 * (`query`), or it has no search and looks one exact name up (`exact`).
 */
export type ExploreSearchMode = 'browse' | 'query' | 'exact';

/**
 * Separates the plugin from the source name in a source's key.
 */
const KEY_SEPARATOR: string = '\u001f';

/**
 * The page a failed search shows: nothing.
 */
const EMPTY_PAGE: PackageSearchResult = { items: [], total: 0, hasMore: false };

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
   * Holds the structured logger for package exploration.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds this tab's package model, which says which package managers are installed for the root.
   */
  private readonly packages: PackageModel = inject(PackageModel);

  /**
   * Holds the generic transport, or undefined when running outside Electron.
   */
  private readonly bridge: Bridge | undefined = window.bridge;

  /**
   * Holds the sources available to browse for the current root, across every installed package
   * manager that can search.
   */
  private readonly sourcesSignal: WritableSignal<readonly ExploreSource[]> = signal<
    readonly ExploreSource[]
  >([]);

  /**
   * Holds the selected source's key, or null when none is chosen yet.
   */
  private readonly selectedSourceSignal: WritableSignal<string | null> = signal<string | null>(
    null,
  );

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
  public readonly sources: Signal<readonly ExploreSource[]> = this.sourcesSignal.asReadonly();

  /**
   * Gets the selected source's key, or null.
   */
  public readonly selectedSource: Signal<string | null> = this.selectedSourceSignal.asReadonly();

  /**
   * Gets the selected source, or null.
   */
  public readonly selected: Signal<ExploreSource | null> = computed(
    (): ExploreSource | null =>
      this.sourcesSignal().find(
        (source: ExploreSource): boolean => source.key === this.selectedSourceSignal(),
      ) ?? null,
  );

  /**
   * Gets how the selected source answers a query.
   */
  public readonly searchMode: Signal<ExploreSearchMode> = computed((): ExploreSearchMode => {
    const capabilities: readonly string[] = this.selected()?.manager.capabilities ?? [];
    if (capabilities.includes('searchExactName')) {
      return 'exact';
    }
    return capabilities.includes('searchRequiresQuery') ? 'query' : 'browse';
  });

  /**
   * Gets whether the selected source can be asked for prerelease versions.
   */
  public readonly canFilterPrereleases: Signal<boolean> = computed((): boolean =>
    (this.selected()?.manager.capabilities ?? []).includes('prerelease'),
  );

  /**
   * Gets the installed package managers that apply to the root but cannot search, so the panel can
   * say so rather than leave them out silently.
   */
  public readonly unsearchable: Signal<readonly PackageManagerSummary[]> = computed(
    (): readonly PackageManagerSummary[] =>
      this.packages
        .installed()
        .filter((manager: PackageManagerSummary): boolean => !canSearch(manager)),
  );

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
      this.installedKey();
      this.reset();
    });
  }

  /**
   * Gets the installed package managers as one key, so a refresh that changes nothing about them does
   * not reset what the user was exploring.
   */
  private readonly installedKey: Signal<string> = computed((): string =>
    this.packages
      .installed()
      .map((manager: PackageManagerSummary): string => manager.pluginId)
      .join(','),
  );

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
    const generation: number = this.generation;
    const bridge: Bridge = this.bridge;
    const searchable: readonly PackageManagerSummary[] = this.packages
      .installed()
      .filter(canSearch);
    let sources: readonly ExploreSource[];
    try {
      const answers: readonly (readonly ExploreSource[])[] = await Promise.all(
        searchable.map(
          async (manager: PackageManagerSummary): Promise<readonly ExploreSource[]> => {
            const answer: PackageAnswer<readonly PackageSourceInfo[]> = await bridge.invoke<
              PackageAnswer<readonly PackageSourceInfo[]>
            >(PackageChannel.Sources, root, manager.pluginId);
            if (!answer.ok) {
              this.log.warn(
                'workspace.packages',
                `${manager.pluginId} lists no sources`,
                answer.error,
              );
              return [];
            }
            return answer.result.map((source: PackageSourceInfo): ExploreSource => ({
              key: `${manager.pluginId}${KEY_SEPARATOR}${source.name}`,
              name: source.name,
              manager,
            }));
          },
        ),
      );
      sources = answers.flat();
    } catch (error: unknown) {
      this.log.warn('workspace.packages', 'Could not list package sources', error);
      // Left unloaded, so reopening the explorer tries again.
      if (generation === this.generation) {
        this.sourcesLoaded = false;
      }
      return;
    }
    // The workspace may have changed while the sources were on their way.
    if (generation !== this.generation) {
      return;
    }
    this.sourcesSignal.set(sources);
    if (sources.length > 0) {
      this.selectedSourceSignal.set(sources[0].key);
      this.runQuery();
    }
  }

  /**
   * Selects the source to browse, resetting and re-running the query against it.
   * @param key The source's key.
   */
  public selectSource(key: string): void {
    this.log.debug('workspace.packages', 'Select explore source', key);
    this.selectedSourceSignal.set(key);
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
    this.log.debug('workspace.packages', 'Set prerelease filter', value);
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
    this.log.trace('workspace.packages', 'Load more explore results', this.resultsSignal().length);
    void this.fetchPage(this.resultsSignal().length, this.generation);
  }

  /**
   * Runs the current query from the first page, replacing any existing results.
   */
  private runQuery(): void {
    this.log.trace('workspace.packages', 'Run explore query', this.querySignal().trim());
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
    const source: ExploreSource | null = this.selected();
    if (this.bridge === undefined || root === null || source === null) {
      return;
    }
    this.loadingSignal.set(true);
    let answer: PackageAnswer<PackageSearchResult>;
    try {
      answer = await this.bridge.invoke<PackageAnswer<PackageSearchResult>>(
        PackageChannel.Search,
        root,
        source.manager.pluginId,
        source.name,
        this.querySignal().trim(),
        {
          skip,
          take: PAGE_SIZE,
          prerelease: this.prereleaseSignal() && this.canFilterPrereleases(),
        },
      );
    } catch (error: unknown) {
      this.log.warn('workspace.packages', 'Package search failed', error);
      // A spinner left on would also block Load More for good.
      if (generation === this.generation) {
        this.loadingSignal.set(false);
      }
      return;
    }
    if (generation !== this.generation) {
      return;
    }
    if (!answer.ok) {
      this.log.warn('workspace.packages', 'Package search failed', answer.error);
    }
    const result: PackageSearchResult = answer.ok ? answer.result : EMPTY_PAGE;
    this.resultsSignal.update(
      (current: readonly PackageSearchItem[]): readonly PackageSearchItem[] =>
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

/**
 * Determines whether a package manager can be explored: it lists sources and searches them.
 * @param manager The package manager.
 * @returns Returns true when it can.
 */
function canSearch(manager: PackageManagerSummary): boolean {
  return manager.capabilities.includes('sources') && manager.capabilities.includes('search');
}
