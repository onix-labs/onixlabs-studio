import { computed, signal, Signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DockPanel } from '@shared/angular/services/dock-layout/dock-panel';
import { FileOpener } from '@shared/angular/services/file-opener/file-opener';
import { Icon } from '@shared/angular/icons/icon';
import type {
  InstalledPackage,
  PackageManagerModel,
  PackageSearchItem,
} from '@shared/api/package-management';
import type {
  PackageManagerSummary,
  PackageWriteOp,
  PackageWriteRequest,
} from '@shared/api/package-channels';
import type { RepositoryTrustDecision } from '@shared/api/source-control-channels';
import type { PluginSummary } from '@shared/api/plugin-channels';
import { Plugins } from '@shared/angular/services/plugins/plugins';
import {
  PackageManagerState,
  PackageModel,
  PackageRow,
  PackageWrite,
} from '@features/workspace/angular/project/package-model';
import {
  ExploreSearchMode,
  ExploreSource,
  PackageExplorer,
} from '@features/workspace/angular/project/package-explorer';

import { PackagesPanel } from './packages-panel';

/**
 * Builds an installed package.
 * @param name The package name.
 * @param status The upgrade verdict.
 * @returns Returns the package.
 */
function installed(name: string, status: InstalledPackage['status']): InstalledPackage {
  return {
    name,
    requested: '^1.0.0',
    installed: '1.0.0',
    latest: status === 'outdated' ? '2.0.0' : '1.0.0',
    status,
    scope: 'production',
  };
}

/**
 * The npm package manager, installed, with every write.
 */
const NPM: PackageManagerSummary = {
  pluginId: 'onixlabs.npm',
  displayName: 'npm',
  ecosystem: 'npm',
  installed: true,
  capabilities: [
    'sources',
    'search',
    'searchRequiresQuery',
    'install',
    'update',
    'remove',
    'restore',
  ],
};

/**
 * A search result.
 */
const LEFT_PAD: PackageSearchItem = {
  name: 'left-pad',
  version: '1.3.0',
  description: 'Pads strings',
  downloads: 1_500_000,
  verified: false,
  sourceName: 'npm',
};

/**
 * A fake installed-package model exposing just the surface the panel reads, with rows each test sets.
 */
class FakePackageModel {
  public readonly rows: WritableSignal<readonly PackageRow[]> = signal<readonly PackageRow[]>([]);
  public readonly hasModels: WritableSignal<boolean> = signal<boolean>(true);
  public readonly loading: WritableSignal<boolean> = signal<boolean>(false);
  public readonly installed: WritableSignal<readonly PackageManagerSummary[]> = signal<
    readonly PackageManagerSummary[]
  >([NPM]);
  public readonly offered: WritableSignal<readonly PluginSummary[]> = signal<
    readonly PluginSummary[]
  >([]);
  public readonly trust: WritableSignal<RepositoryTrustDecision> =
    signal<RepositoryTrustDecision>('trusted');
  public readonly states: WritableSignal<readonly PackageManagerState[]> = signal<
    readonly PackageManagerState[]
  >([]);
  public readonly writing: WritableSignal<PackageWrite | null> = signal<PackageWrite | null>(null);
  public readonly writeError: WritableSignal<string | null> = signal<string | null>(null);
  public readonly outdatedOnly: WritableSignal<boolean> = signal<boolean>(false);
  public readonly outdatedCount: Signal<number> = computed((): number =>
    this.rows().reduce(
      (total: number, row: PackageRow): number =>
        total + (row.kind === 'project' ? row.outdated : 0),
      0,
    ),
  );
  public refreshed: number = 0;
  public trusted: number = 0;
  public readonly writes: [string, PackageWriteOp, PackageWriteRequest][] = [];

  public setOutdatedOnly(value: boolean): void {
    this.outdatedOnly.set(value);
  }

  public refreshNow(): void {
    this.refreshed += 1;
  }

  public trustFolder(): Promise<void> {
    this.trusted += 1;
    return Promise.resolve();
  }

  public write(pluginId: string, op: PackageWriteOp, request: PackageWriteRequest): Promise<void> {
    this.writes.push([pluginId, op, request]);
    return Promise.resolve();
  }
}

/**
 * A fake package explorer exposing just the surface the panel reads.
 */
class FakePackageExplorer {
  public readonly sources: WritableSignal<readonly ExploreSource[]> = signal<
    readonly ExploreSource[]
  >([]);
  public readonly selected: WritableSignal<ExploreSource | null> = signal<ExploreSource | null>(
    null,
  );
  public readonly searchMode: WritableSignal<ExploreSearchMode> =
    signal<ExploreSearchMode>('browse');
  public readonly canFilterPrereleases: WritableSignal<boolean> = signal<boolean>(true);
  public readonly unsearchable: WritableSignal<readonly PackageManagerSummary[]> = signal<
    readonly PackageManagerSummary[]
  >([]);
  public readonly selectedSource: WritableSignal<string | null> = signal<string | null>(null);
  public readonly query: WritableSignal<string> = signal<string>('');
  public readonly prerelease: WritableSignal<boolean> = signal<boolean>(false);
  public readonly results: WritableSignal<readonly PackageSearchItem[]> = signal<
    readonly PackageSearchItem[]
  >([]);
  public readonly loading: WritableSignal<boolean> = signal<boolean>(false);
  public readonly hasMore: WritableSignal<boolean> = signal<boolean>(false);
  public readonly total: WritableSignal<number> = signal<number>(0);
  public sourcesRequested: number = 0;

  public ensureSources(): Promise<void> {
    this.sourcesRequested += 1;
    return Promise.resolve();
  }

  public selectSource(key: string): void {
    this.selectedSource.set(key);
  }

  public setQuery(value: string): void {
    this.query.set(value);
  }

  public setPrerelease(value: boolean): void {
    this.prerelease.set(value);
  }

  public loadMore(): void {
    // Not exercised.
  }
}

describe('PackagesPanel', () => {
  let fixture: ComponentFixture<PackagesPanel>;
  let packages: FakePackageModel;
  let explorer: FakePackageExplorer;
  let opened: string[];

  const panel: DockPanel = {
    id: 'packages',
    title: 'Packages',
    icon: Icon.PACKAGES,
    role: 'tool',
    component: PackagesPanel,
  };

  beforeEach(async () => {
    packages = new FakePackageModel();
    explorer = new FakePackageExplorer();
    opened = [];

    await TestBed.configureTestingModule({
      imports: [PackagesPanel],
      providers: [
        { provide: PackageModel, useValue: packages },
        { provide: PackageExplorer, useValue: explorer },
        { provide: Plugins, useValue: { plugins: signal([]), busy: signal(false) } },
        {
          provide: FileOpener,
          useValue: {
            openPath: (path: string): Promise<boolean> => {
              opened.push(path);
              return Promise.resolve(true);
            },
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PackagesPanel);
    fixture.componentRef.setInput('panel', panel);
  });

  /**
   * Gets the panel's host element.
   * @returns Returns it.
   */
  function host(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  /**
   * Finds a button by its visible text or its accessible name.
   * @param name The text or name.
   * @returns Returns the button, or undefined.
   */
  function button(name: string): HTMLButtonElement | undefined {
    return [...host().querySelectorAll<HTMLButtonElement>('button')].find(
      (candidate: HTMLButtonElement): boolean =>
        candidate.textContent?.trim() === name || candidate.getAttribute('aria-label') === name,
    );
  }

  /**
   * Sets the installed rows: a project per entry, with its packages under it.
   * @param entries Each project's name and its packages' upgrade verdicts.
   */
  function projects(...entries: [string, InstalledPackage['status'][]][]): void {
    const rows: PackageRow[] = [];
    for (const [name, statuses] of entries) {
      const key: string = `/work/${name}/package.json`;
      const outdated: number = statuses.filter(
        (status: string): boolean => status === 'outdated',
      ).length;
      rows.push({ kind: 'project', key, name, outdated, pluginId: NPM.pluginId, manager: 'npm' });
      statuses.forEach((status: InstalledPackage['status'], index: number): void => {
        rows.push({
          kind: 'package',
          key: `${key}#${index}`,
          package: installed(`p${index}`, status),
          pluginId: NPM.pluginId,
          project: key,
        });
      });
    }
    packages.rows.set(rows);
    fixture.detectChanges();
  }

  /**
   * Switches to Explore with one npm source selected, holding the given results.
   * @param results The results.
   * @param manager The source's package manager.
   */
  function exploring(
    results: readonly PackageSearchItem[],
    manager: PackageManagerSummary = NPM,
  ): void {
    const source: ExploreSource = { key: `${manager.pluginId}/npm`, name: 'npm', manager };
    explorer.sources.set([source]);
    explorer.selected.set(source);
    explorer.selectedSource.set(source.key);
    explorer.results.set(results);
    explorer.total.set(results.length + 10);
    projects();
    button('Explore')!.click();
    fixture.detectChanges();
  }

  /**
   * Gives the npm package manager a model with the named projects, for Explore's install target.
   * @param names The projects.
   */
  function npmProjects(...names: string[]): void {
    const model: PackageManagerModel = {
      ecosystem: 'npm',
      root: '/work',
      projects: names.map((name: string) => ({
        name,
        manifestPath: `/work/${name}/package.json`,
        packages: [],
      })),
    };
    packages.states.set([{ manager: NPM, model, error: null, loading: false }]);
  }

  describe('strip', () => {
    it('strip_holdsInstalledAndExplore_withUpdatesOnlyAndRefreshOnlyInInstalled', () => {
      projects(['web', ['current']]);

      expect(host().querySelectorAll('.packages-strip__toggle')).toHaveLength(2);
      expect(button('Updates Only')).toBeDefined();
      expect(button('Refresh')).toBeDefined();

      button('Explore')!.click();
      fixture.detectChanges();

      expect(button('Updates Only')).toBeUndefined();
      expect(button('Refresh')).toBeUndefined();
      expect(explorer.sourcesRequested).toBe(1);
    });

    it('updatesOnly_toggles_theModelsFilter', () => {
      projects(['web', ['current']]);

      button('Updates Only')!.click();
      expect(packages.outdatedOnly()).toBe(true);
      button('Updates Only')!.click();
      expect(packages.outdatedOnly()).toBe(false);
    });

    it('refresh_reloadsTheModel', () => {
      projects(['web', ['current']]);

      button('Refresh')!.click();

      expect(packages.refreshed).toBe(1);
    });
  });

  describe('installed', () => {
    it('groupBadge_whenAProjectHasOutdatedPackages_isAWarningChipWithTheCount', () => {
      projects(['web', ['outdated', 'current', 'outdated']]);

      const chip: HTMLElement | null = host().querySelector<HTMLElement>(
        '.packages-group app-chip.packages-group__badge',
      );
      expect(chip?.classList).toContain('chip--warning');
      expect(chip?.textContent?.trim()).toBe('2');
    });

    it('groupHeader_namesItsPackageManager_onlyWhenSeveralReadTheFolder', () => {
      projects(['web', ['current']]);
      expect(host().querySelector('.packages-group__manager')).toBeNull();

      packages.installed.set([NPM, { ...NPM, pluginId: 'onixlabs.nuget', displayName: 'NuGet' }]);
      fixture.detectChanges();

      expect(host().querySelector('.packages-group__manager')?.textContent?.trim()).toBe('npm');
    });

    it('scope_isAChip', () => {
      projects(['web', ['current']]);

      expect(host().querySelector('.packages-scope app-chip')?.textContent?.trim()).toBe(
        'production',
      );
    });

    it('update_isOfferedOnAnOutdatedPackage_andAsksForTheLatest', () => {
      projects(['web', ['outdated', 'current']]);

      expect(button('Update p1')).toBeUndefined();
      button('Update p0')!.click();

      expect(packages.writes).toEqual([
        [
          NPM.pluginId,
          'update',
          { project: '/work/web/package.json', name: 'p0', version: '2.0.0' },
        ],
      ]);
    });

    it('remove_asksToRemoveThePackageFromItsProject', () => {
      projects(['web', ['current']]);

      button('Remove p0')!.click();

      expect(packages.writes).toEqual([
        [NPM.pluginId, 'remove', { project: '/work/web/package.json', name: 'p0' }],
      ]);
    });

    it('restore_onAProjectHeader_restoresIt_withoutOpeningTheManifest', () => {
      projects(['web', ['current']]);

      button('Restore web')!.click();

      expect(packages.writes).toEqual([
        [NPM.pluginId, 'restore', { project: '/work/web/package.json' }],
      ]);
      expect(opened).toEqual([]);
    });

    it('writes_areNotOffered_whereThePluginDeclaredNone', () => {
      packages.installed.set([{ ...NPM, capabilities: ['sources', 'search'] }]);
      projects(['web', ['outdated']]);

      expect(button('Update p0')).toBeUndefined();
      expect(button('Remove p0')).toBeUndefined();
      expect(button('Restore web')).toBeUndefined();
    });

    it('aRunningChange_showsOnItsRow_andDisablesTheOthers', () => {
      packages.writing.set({
        pluginId: NPM.pluginId,
        op: 'update',
        request: { project: '/work/web/package.json', name: 'p0' },
        title: 'Update p0',
      });
      projects(['web', ['outdated', 'outdated']]);

      expect(button('Update p0')).toBeUndefined();
      expect(button('Update p1')?.disabled).toBe(true);
      expect(host().querySelector('.packages-status')?.textContent).toContain('Update p0');
    });

    it('emptyState_whenFilteringToUpdatesWithNothingOutdated_saysEverythingIsUpToDate', () => {
      packages.outdatedOnly.set(true);
      projects();

      expect(host().textContent).toContain('Everything is up to date.');
    });

    it('emptyState_whileResolvingTheFirstModel_showsProgress', () => {
      packages.hasModels.set(false);
      packages.loading.set(true);
      fixture.detectChanges();

      expect(host().textContent).toContain('Resolving packages…');
    });

    it('emptyState_withNoPackageManagerInstalled_offersThePluginThatWouldReadTheFolder', () => {
      packages.installed.set([]);
      packages.hasModels.set(false);
      packages.offered.set([
        { id: 'onixlabs.npm', name: 'npm', state: 'available', contributions: [] },
      ] as unknown as PluginSummary[]);
      fixture.detectChanges();

      expect(host().textContent).toContain(
        "Install a package manager to see this folder's packages.",
      );
      expect(host().querySelector('.packages-offers__name')?.textContent?.trim()).toBe('npm');
      expect(host().querySelector('app-plugin-action')).not.toBeNull();
    });

    it('emptyState_inAFolderNotYetTrusted_offersToTrustIt', () => {
      packages.trust.set('unknown');
      packages.hasModels.set(false);
      fixture.detectChanges();

      button('Trust this folder')!.click();

      expect(host().textContent).toContain("This folder isn't trusted");
      expect(packages.trusted).toBe(1);
    });

    it('emptyState_whenEveryPackageManagerFailed_saysWhy', () => {
      packages.hasModels.set(false);
      packages.states.set([{ manager: NPM, model: null, error: 'npm broke.', loading: false }]);
      fixture.detectChanges();

      expect(host().textContent).toContain('npm broke.');
    });
  });

  describe('status strip', () => {
    it('status_withOutdatedPackages_isAWarningChip', () => {
      projects(['web', ['outdated']], ['api', ['outdated', 'outdated']]);

      const chip: HTMLElement | null = host().querySelector('.packages-status app-chip');
      expect(chip?.classList).toContain('chip--warning');
      expect(chip?.textContent?.trim()).toBe('3 outdated');
    });

    it('status_withNothingOutdated_isAnUpToDateSuccessChip', () => {
      projects(['web', ['current']]);

      const chip: HTMLElement | null = host().querySelector('.packages-status app-chip');
      expect(chip?.classList).toContain('chip--success');
      expect(chip?.textContent?.trim()).toBe('Up to date');
    });

    it('status_inExplore_countsWhatIsLoadedOfTheTotal', () => {
      exploring([LEFT_PAD]);

      expect(host().querySelector('.packages-status app-chip')?.textContent?.trim()).toBe(
        '1 of 11',
      );
    });

    it('status_afterAFailedChange_saysWhy', () => {
      packages.writeError.set('Install left-pad ended with exit code 1.');
      projects(['web', ['current']]);

      expect(host().querySelector('.packages-status .chip--danger')?.textContent?.trim()).toBe(
        'Install left-pad ended with exit code 1.',
      );
    });
  });

  describe('explore', () => {
    it('columns_arePackageDescriptionDownloadsVersion', () => {
      exploring([LEFT_PAD]);

      const headers: string[] = [...host().querySelectorAll('th')].map(
        (cell: Element): string => cell.textContent?.trim() ?? '',
      );
      expect(headers.slice(0, 4)).toEqual(['Package', 'Description', 'Downloads', 'Version']);
      expect(host().querySelector('.packages-downloads')?.textContent?.trim()).toBe('1.5M');
    });

    it('form_isOneRow_withPrereleasesOnlyForASourceThatCanFilterThem', () => {
      explorer.canFilterPrereleases.set(false);
      exploring([LEFT_PAD]);

      expect(host().querySelector('.packages-form')).not.toBeNull();
      expect(host().querySelector('.packages-form__prerelease')).toBeNull();

      explorer.canFilterPrereleases.set(true);
      fixture.detectChanges();

      expect(host().querySelector('.packages-form__prerelease')).not.toBeNull();
    });

    it('aSourceThatNeedsText_saysSoWhileTheFieldIsEmpty', () => {
      explorer.searchMode.set('query');
      exploring([]);

      expect(host().textContent).toContain('Type to search npm.');
    });

    it('aRegistryWithNoSearch_saysItLooksUpAnExactName', () => {
      explorer.searchMode.set('exact');
      exploring([]);

      expect(host().textContent).toContain(
        "npm has no search. Type a package's exact name to look it up.",
      );
      expect(
        host().querySelector<HTMLInputElement>('.packages-form__search input')?.placeholder,
      ).toBe('Exact package name on npm');
      expect(host().querySelector('.packages-status')?.textContent).toContain('Exact name only');
    });

    it('install_withOneProject_goesIntoIt_atTheListedVersion', () => {
      npmProjects('web');
      exploring([LEFT_PAD]);

      expect(host().querySelector('.packages-form__target')).toBeNull();
      button('Install left-pad')!.click();

      expect(packages.writes).toEqual([
        [
          NPM.pluginId,
          'install',
          { project: '/work/web/package.json', name: 'left-pad', version: '1.3.0' },
        ],
      ]);
    });

    it('install_withSeveralProjects_offersWhereItGoes', () => {
      npmProjects('web', 'api');
      exploring([LEFT_PAD]);

      expect(host().querySelector('.packages-form__target')).not.toBeNull();
    });

    it('install_isNotOffered_byAPackageManagerThatCannot', () => {
      npmProjects('web');
      exploring([LEFT_PAD], { ...NPM, capabilities: ['sources', 'search'] });

      expect(button('Install left-pad')).toBeUndefined();
    });

    it('explore_withOnlyManagersThatCannotSearch_namesThem', () => {
      explorer.unsearchable.set([{ ...NPM, displayName: 'Maven' }]);
      projects();
      button('Explore')!.click();
      fixture.detectChanges();

      expect(host().textContent).toContain('Maven cannot search its registry');
    });

    it('loadMore_isOfferedAtTheEnd_whileThereIsMore', () => {
      explorer.hasMore.set(true);
      exploring([LEFT_PAD]);

      expect(button('Load more')).toBeDefined();
    });
  });
});
