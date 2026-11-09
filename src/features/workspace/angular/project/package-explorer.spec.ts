import { Signal, signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Bridge } from '@shared/api/bridge';
import { PackageChannel, PackageManagerSummary } from '@shared/api/package-channels';
import type { PackageSearchItem, PackageSearchResult } from '@shared/api/package-management';
import { Workspace } from '@shared/angular/services/workspace/workspace';
import { PackageExplorer } from './package-explorer';
import { PackageModel } from './package-model';

/**
 * The NuGet package manager, which browses with no query and filters prereleases.
 */
const NUGET: PackageManagerSummary = {
  pluginId: 'onixlabs.nuget',
  displayName: 'NuGet',
  ecosystem: 'nuget',
  installed: true,
  capabilities: ['sources', 'search', 'prerelease'],
};

/**
 * Builds the key a NuGet source is selected by.
 * @param name The source's name.
 * @returns Returns the key.
 */
function key(name: string): string {
  return `${NUGET.pluginId}\u001f${name}`;
}

/**
 * A search the test answers by hand.
 */
interface HeldSearch {
  readonly query: string;
  readonly options: { skip: number; take: number; prerelease: boolean };
  readonly source: string;
  readonly finish: (result: PackageSearchResult) => void;
  readonly fail: (error: Error) => void;
}

/**
 * Builds a page of results named after their position.
 */
function page(skip: number, count: number, hasMore: boolean): PackageSearchResult {
  const items: PackageSearchItem[] = Array.from(
    { length: count },
    (_value: unknown, index: number): PackageSearchItem =>
      ({ id: `package-${skip + index}` }) as unknown as PackageSearchItem,
  );
  return { items, total: skip + count + (hasMore ? 1 : 0), hasMore };
}

describe('PackageExplorer', () => {
  let explorer: PackageExplorer;
  let root: WritableSignal<{ path: string } | null>;
  let searches: HeldSearch[];
  let sources: () => Promise<unknown>;
  let installed: WritableSignal<readonly PackageManagerSummary[]>;

  /**
   * Waits for a number of searches to be under way.
   */
  async function searching(count: number): Promise<HeldSearch> {
    await vi.waitFor((): void => {
      expect(searches.length).toBeGreaterThanOrEqual(count);
    });
    const search: HeldSearch | undefined = searches[count - 1];
    if (search === undefined) {
      throw new Error('No search');
    }
    return search;
  }

  /**
   * Finishes a search and lets its answer land.
   */
  async function answer(search: HeldSearch, result: PackageSearchResult): Promise<void> {
    search.finish(result);
    await Promise.resolve();
    await Promise.resolve();
  }

  /**
   * Reads the ids listed.
   */
  function listed(): readonly unknown[] {
    return explorer
      .results()
      .map((item: PackageSearchItem): unknown => (item as unknown as { id: unknown }).id);
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    root = signal<{ path: string } | null>({ path: '/fixture' });
    searches = [];
    installed = signal<readonly PackageManagerSummary[]>([NUGET]);
    sources = async (): Promise<unknown> =>
      Promise.resolve([{ name: 'nuget' }, { name: 'private' }]);
    const bridge: Bridge = {
      invoke: <T>(channel: string, ...args: unknown[]): Promise<T> => {
        if (channel === (PackageChannel.Sources as string)) {
          return sources().then((result: unknown): T => ({ ok: true, result }) as T);
        }
        return new Promise<T>(
          (resolve: (value: T) => void, reject: (error: Error) => void): void => {
            searches.push({
              source: args[2] as string,
              query: args[3] as string,
              options: args[4] as HeldSearch['options'],
              finish: (result: PackageSearchResult): void => {
                resolve({ ok: true, result } as T);
              },
              fail: reject,
            });
          },
        );
      },
      send: (): void => undefined,
      on: (): (() => void) => (): void => undefined,
    };
    (window as unknown as { bridge: Bridge }).bridge = bridge;
    TestBed.configureTestingModule({
      providers: [
        { provide: Workspace, useValue: { root: root as Signal<{ path: string } | null> } },
        { provide: PackageModel, useValue: { installed } },
      ],
    });
    explorer = TestBed.inject(PackageExplorer);
    TestBed.tick();
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (window as unknown as { bridge?: unknown }).bridge;
  });

  describe('sources', () => {
    it('sources_selectTheFirstAndSearchIt', async () => {
      await explorer.ensureSources();

      expect(explorer.sources()).toHaveLength(2);
      expect(explorer.selectedSource()).toBe(key('nuget'));
      expect((await searching(1)).source).toBe('nuget');
    });

    it('sources_areFetchedOnce', async () => {
      let fetched: number = 0;
      sources = async (): Promise<unknown> => {
        fetched += 1;
        return Promise.resolve([]);
      };

      await explorer.ensureSources();
      await explorer.ensureSources();

      expect(fetched).toBe(1);
      expect(explorer.selectedSource()).toBeNull();
    });

    it('sources_withNoWorkspace_askNothing', async () => {
      root.set(null);
      TestBed.tick();

      await explorer.ensureSources();

      expect(explorer.sources()).toEqual([]);
    });

    it('sources_whenTheBridgeRejects_canBeRetried', async () => {
      sources = async (): Promise<unknown> => Promise.reject(new Error('gone'));
      await explorer.ensureSources();
      expect(explorer.sources()).toEqual([]);

      sources = async (): Promise<unknown> => Promise.resolve([{ name: 'nuget' }]);
      await explorer.ensureSources();

      expect(explorer.sources()).toHaveLength(1);
    });

    it('sources_arrivingAfterTheWorkspaceChanged_areDropped', async () => {
      let finish: (value: unknown) => void = (): void => undefined;
      sources = async (): Promise<unknown> =>
        new Promise<unknown>((resolve: (value: unknown) => void): void => {
          finish = resolve;
        });
      const loading: Promise<void> = explorer.ensureSources();

      root.set({ path: '/other' });
      TestBed.tick();
      finish([{ name: 'stale' }]);
      await loading;

      expect(explorer.sources()).toEqual([]);
      expect(searches).toEqual([]);
    });
  });

  describe('searching', () => {
    beforeEach(async () => {
      await explorer.ensureSources();
      await answer(await searching(1), page(0, 2, true));
    });

    it('search_listsResultsAndStopsLoading', () => {
      expect(listed()).toEqual(['package-0', 'package-1']);
      expect(explorer.total()).toBe(3);
      expect(explorer.hasMore()).toBe(true);
      expect(explorer.loading()).toBe(false);
    });

    it('loadMore_appendsTheNextPage', async () => {
      explorer.loadMore();
      const next: HeldSearch = await searching(2);
      expect(next.options.skip).toBe(2);

      await answer(next, page(2, 1, false));

      expect(listed()).toEqual(['package-0', 'package-1', 'package-2']);
      expect(explorer.hasMore()).toBe(false);
    });

    it('loadMore_whileLoadingOrAtTheEnd_doesNothing', async () => {
      explorer.loadMore();
      explorer.loadMore();
      await searching(2);
      expect(searches).toHaveLength(2);

      await answer(searches[1], page(2, 1, false));
      explorer.loadMore();

      expect(searches).toHaveLength(2);
    });

    it('typing_waitsForAPauseThenSearchesTheLastText', async () => {
      explorer.setQuery('a');
      explorer.setQuery('ab ');
      vi.advanceTimersByTime(299);
      expect(searches).toHaveLength(1);

      vi.advanceTimersByTime(1);

      expect((await searching(2)).query).toBe('ab');
      expect(searches).toHaveLength(2);
    });

    it('anOlderSearch_arrivingLate_isDropped', async () => {
      explorer.selectSource(key('private'));
      const older: HeldSearch = await searching(2);
      explorer.setPrerelease(true);
      const newer: HeldSearch = await searching(3);
      expect(newer.options.prerelease).toBe(true);

      await answer(newer, page(0, 1, false));
      await answer(older, page(0, 2, true));

      expect(listed()).toEqual(['package-0']);
      expect(explorer.hasMore()).toBe(false);
    });

    it('search_whenTheBridgeRejects_stopsLoadingSoItCanContinue', async () => {
      explorer.selectSource(key('private'));
      const failed: HeldSearch = await searching(2);
      expect(explorer.loading()).toBe(true);

      failed.fail(new Error('feed is down'));
      await vi.waitFor((): void => {
        expect(explorer.loading()).toBe(false);
      });

      expect(listed()).toEqual([]);
    });

    it('anOlderSearch_failingLate_leavesTheNewerSpinner', async () => {
      explorer.selectSource(key('private'));
      const older: HeldSearch = await searching(2);
      explorer.selectSource(key('nuget'));
      await searching(3);

      older.fail(new Error('feed is down'));
      await Promise.resolve();
      await Promise.resolve();

      expect(explorer.loading()).toBe(true);
    });

    it('changingWorkspace_clearsEverything_andCancelsThePendingSearch', () => {
      explorer.setQuery('pending');

      root.set({ path: '/other' });
      TestBed.tick();
      vi.advanceTimersByTime(400);

      expect(listed()).toEqual([]);
      expect(explorer.query()).toBe('');
      expect(explorer.selectedSource()).toBeNull();
      expect(searches).toHaveLength(1);
    });
  });

  describe('several package managers', () => {
    it('sources_comeFromEveryManagerThatSearches_andSayHowEachIsSearched', async () => {
      const pypi: PackageManagerSummary = {
        pluginId: 'onixlabs.pypi',
        displayName: 'PyPI',
        ecosystem: 'pypi',
        installed: true,
        capabilities: ['sources', 'search', 'searchExactName'],
      };
      const maven: PackageManagerSummary = {
        ...pypi,
        pluginId: 'onixlabs.maven',
        capabilities: [],
      };
      installed.set([NUGET, pypi, maven]);
      TestBed.tick();

      await explorer.ensureSources();

      expect(explorer.sources().map((source) => source.manager.pluginId)).toEqual([
        'onixlabs.nuget',
        'onixlabs.nuget',
        'onixlabs.pypi',
        'onixlabs.pypi',
      ]);
      expect(explorer.searchMode()).toBe('browse');
      expect(explorer.canFilterPrereleases()).toBe(true);
      explorer.selectSource(`onixlabs.pypi\u001fnuget`);
      expect(explorer.searchMode()).toBe('exact');
      expect(explorer.canFilterPrereleases()).toBe(false);
      expect(explorer.unsearchable()).toEqual([maven]);
    });

    it('search_namesThePluginTheSourceBelongsTo', async () => {
      await explorer.ensureSources();

      await searching(1);

      expect(searches[0].source).toBe('nuget');
    });
  });
});
