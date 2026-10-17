import { computed, signal, Signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DockPanel } from '@shared/angular/services/dock-layout/dock-panel';
import { FileOpener } from '@shared/angular/services/file-opener/file-opener';
import { Icon } from '@shared/angular/icons/icon';
import type {
  InstalledPackage,
  PackageManagerModel,
  PackageSearchItem,
  PackageSourceInfo,
} from '@shared/api/package-management';
import { PackageModel, PackageRow } from '@features/workspace/angular/project/package-model';
import { PackageExplorer } from '@features/workspace/angular/project/package-explorer';

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
 * A fake installed-package model exposing just the surface the panel reads, with rows each test sets.
 */
class FakePackageModel {
  public readonly rows: WritableSignal<readonly PackageRow[]> = signal<readonly PackageRow[]>([]);
  public readonly model: WritableSignal<PackageManagerModel | null> =
    signal<PackageManagerModel | null>({} as PackageManagerModel);
  public readonly loading: WritableSignal<boolean> = signal<boolean>(false);
  public readonly outdatedOnly: WritableSignal<boolean> = signal<boolean>(false);
  public readonly outdatedCount: Signal<number> = computed((): number =>
    this.rows().reduce(
      (total: number, row: PackageRow): number =>
        total + (row.kind === 'project' ? row.outdated : 0),
      0,
    ),
  );
  public refreshed: number = 0;

  public setOutdatedOnly(value: boolean): void {
    this.outdatedOnly.set(value);
  }

  public refreshNow(): void {
    this.refreshed += 1;
  }
}

/**
 * A fake package explorer exposing just the surface the panel reads.
 */
class FakePackageExplorer {
  public readonly sources: WritableSignal<readonly PackageSourceInfo[]> = signal<
    readonly PackageSourceInfo[]
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

  public selectSource(name: string): void {
    this.selectedSource.set(name);
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
      rows.push({ kind: 'project', key, name, outdated });
      statuses.forEach((status: InstalledPackage['status'], index: number): void => {
        rows.push({
          kind: 'package',
          key: `${key}#${index}`,
          package: installed(`p${index}`, status),
        });
      });
    }
    packages.rows.set(rows);
    fixture.detectChanges();
  }

  it('groupBadge_whenAProjectHasOutdatedPackages_isAWarningChipWithTheCount', () => {
    projects(['web', ['outdated', 'current', 'outdated']]);

    const chip: HTMLElement | null = host().querySelector<HTMLElement>(
      '.packages-group app-chip.packages-group__badge',
    );
    expect(chip).not.toBeNull();
    expect(chip?.classList).toContain('chip--warning');
    expect(chip?.textContent?.trim()).toBe('2');
  });

  it('groupBadge_whenAProjectIsUpToDate_isAbsent', () => {
    projects(['web', ['current', 'current']]);

    expect(host().querySelector('.packages-group')).not.toBeNull();
    expect(host().querySelector('.packages-group__badge')).toBeNull();
  });

  it('toolbarTally_showsTheOutdatedCountAcrossProjects_onlyWhenThereAreAny', () => {
    projects(['web', ['outdated']], ['api', ['outdated', 'outdated']]);
    expect(host().querySelector('.packages-count--outdated')?.textContent?.trim()).toBe('3');

    projects(['web', ['current']]);
    expect(host().querySelector('.packages-count--outdated')).toBeNull();
  });

  it('emptyState_whenFilteringToUpdatesWithNothingOutdated_saysEverythingIsUpToDate', () => {
    packages.outdatedOnly.set(true);
    projects();

    expect(host().textContent).toContain('Everything is up to date.');
  });

  it('emptyState_whileResolvingTheFirstModel_showsProgress', () => {
    packages.model.set(null);
    packages.loading.set(true);
    fixture.detectChanges();

    expect(host().textContent).toContain('Resolving packages…');
  });

  it('updatesOnly_toggles_theModelsFilter', () => {
    projects(['web', ['current']]);
    const toggle: HTMLButtonElement = [
      ...host().querySelectorAll<HTMLButtonElement>('button'),
    ].find(
      (button: HTMLButtonElement): boolean => button.textContent?.includes('Updates only') === true,
    )!;

    toggle.click();
    expect(packages.outdatedOnly()).toBe(true);
    toggle.click();
    expect(packages.outdatedOnly()).toBe(false);
  });

  it('refresh_reloadsTheModel', () => {
    projects(['web', ['current']]);
    const refresh: HTMLButtonElement = [
      ...host().querySelectorAll<HTMLButtonElement>('button'),
    ].find(
      (button: HTMLButtonElement): boolean => button.textContent?.includes('Refresh') === true,
    )!;

    refresh.click();

    expect(packages.refreshed).toBe(1);
  });

  it('explore_loadsTheSourcesTheFirstTime_andSaysWhenThereAreNone', () => {
    projects();
    const explore: HTMLButtonElement = [
      ...host().querySelectorAll<HTMLButtonElement>('button'),
    ].find(
      (button: HTMLButtonElement): boolean => button.textContent?.includes('Explore') === true,
    )!;

    explore.click();
    fixture.detectChanges();

    expect(explorer.sourcesRequested).toBe(1);
    expect(host().textContent).toContain("Exploration isn't available for this workspace.");
  });
});
