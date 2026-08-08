import { computed, effect, inject, Service, signal, Signal, WritableSignal } from '@angular/core';
import { Bridge } from '@shared/api/bridge';
import { PackageChannel } from '@shared/api/package-channels';
import {
  InstalledPackage,
  PackageManagerModel,
  PackageProject,
  PackageUpdateStatus,
} from '@shared/api/package-management';
import { Workspace } from '@shared/angular/services/workspace/workspace';

/**
 * A flattened Package Management row: either a project header or one of its packages, with its display
 * fields resolved so the panel renders it directly.
 */
export type PackageRow =
  | {
      /**
       * Identifies a project header row.
       */
      readonly kind: 'project';

      /**
       * Holds the row's stable identity (the manifest path), used as the render key.
       */
      readonly key: string;

      /**
       * Holds the project's display name.
       */
      readonly name: string;

      /**
       * Holds how many of the project's packages are outdated, shown as a badge on the header.
       */
      readonly outdated: number;
    }
  | {
      /**
       * Identifies a package row.
       */
      readonly kind: 'package';

      /**
       * Holds the row's stable identity (project path plus package name), used as the render key.
       */
      readonly key: string;

      /**
       * Holds the package.
       */
      readonly package: InstalledPackage;
    };

/**
 * Holds and drives this tab's Package Management model. When a workspace with a recognised package
 * ecosystem opens, it fetches the package model for the root — the projects it holds and the packages
 * each declares, with installed and latest versions resolved by the main process — and exposes it as a
 * flattened row list the panel renders. Exposes the model's presence (which the directory view uses to
 * show or hide the panel) and an outdated-only filter. Provided per directory tab. Outside Electron the
 * bridge is absent and the model stays null.
 */
@Service()
export class PackageModel {
  /**
   * Holds this tab's workspace, whose root the model is built for.
   */
  private readonly workspace: Workspace = inject(Workspace);

  /**
   * Holds the generic transport, or undefined when running outside Electron.
   */
  private readonly bridge: Bridge | undefined = window.bridge;

  /**
   * Holds the current model, or null when no root is open or none was recognised.
   */
  private readonly current: WritableSignal<PackageManagerModel | null> =
    signal<PackageManagerModel | null>(null);

  /**
   * Holds whether a model load is currently in flight, so the panel can show a loading state.
   */
  private readonly loadingSignal: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds whether the row list is filtered to outdated packages only.
   */
  private readonly outdatedOnlySignal: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds the generation of the current load, so a stale load (the root changed while it was in flight)
   * does not apply its results.
   */
  private generation: number = 0;

  /**
   * Gets the current package model, or null when there is none.
   */
  public readonly model: Signal<PackageManagerModel | null> = this.current.asReadonly();

  /**
   * Gets whether a model load is currently in flight.
   */
  public readonly loading: Signal<boolean> = this.loadingSignal.asReadonly();

  /**
   * Gets whether the row list is filtered to outdated packages only.
   */
  public readonly outdatedOnly: Signal<boolean> = this.outdatedOnlySignal.asReadonly();

  /**
   * Gets the total number of outdated packages across every project, shown as a summary.
   */
  public readonly outdatedCount: Signal<number> = computed((): number => {
    const model: PackageManagerModel | null = this.current();
    if (model === null) {
      return 0;
    }
    return model.projects.reduce(
      (total: number, project: PackageProject): number =>
        total + project.packages.filter((entry: InstalledPackage): boolean => entry.status === 'outdated').length,
      0,
    );
  });

  /**
   * Gets the flattened, visible rows: a header per project followed by its packages, filtered to the
   * outdated ones while the outdated-only filter is on. Projects with no visible packages are dropped.
   */
  public readonly rows: Signal<readonly PackageRow[]> = computed((): readonly PackageRow[] => {
    const model: PackageManagerModel | null = this.current();
    if (model === null) {
      return [];
    }
    const outdatedOnly: boolean = this.outdatedOnlySignal();
    const rows: PackageRow[] = [];
    for (const project of model.projects) {
      const visible: readonly InstalledPackage[] = outdatedOnly
        ? project.packages.filter((entry: InstalledPackage): boolean => entry.status === 'outdated')
        : project.packages;
      if (visible.length === 0) {
        continue;
      }
      const outdated: number = project.packages.filter(
        (entry: InstalledPackage): boolean => entry.status === 'outdated',
      ).length;
      rows.push({ kind: 'project', key: project.manifestPath, name: project.name, outdated });
      for (const entry of this.ordered(visible)) {
        rows.push({ kind: 'package', key: `${project.manifestPath}:${entry.name}`, package: entry });
      }
    }
    return rows;
  });

  /**
   * Initializes a new instance of the {@link PackageModel} class, refreshing the model whenever the
   * open root changes.
   */
  public constructor() {
    effect((): void => {
      const root: string | null = this.workspace.root()?.path ?? null;
      void this.refresh(root);
    });
  }

  /**
   * Sets whether the row list is filtered to outdated packages only.
   * @param value Whether to show outdated packages only.
   */
  public setOutdatedOnly(value: boolean): void {
    this.outdatedOnlySignal.set(value);
  }

  /**
   * Reloads the model for the current root, re-resolving installed and latest versions. A no-op when
   * there is no open root.
   */
  public refreshNow(): void {
    void this.refresh(this.workspace.root()?.path ?? null);
  }

  /**
   * Loads the model for a root, clearing it when there is no root or bridge. A stale response (the root
   * changed again while the request was in flight) is discarded.
   * @param root The workspace root, or null when none is open.
   * @returns Returns a promise that resolves once the model has been updated.
   */
  private async refresh(root: string | null): Promise<void> {
    const generation: number = ++this.generation;
    if (this.bridge === undefined || root === null) {
      this.current.set(null);
      this.loadingSignal.set(false);
      return;
    }
    this.loadingSignal.set(true);
    const model: PackageManagerModel | null = await this.bridge.invoke<PackageManagerModel | null>(
      PackageChannel.ModelLoad,
      root,
    );
    if (generation !== this.generation) {
      return;
    }
    this.current.set(model);
    this.loadingSignal.set(false);
  }

  /**
   * Orders a run of packages for display: outdated first (the actionable ones), then by name, so the
   * upgrades a developer cares about sit at the top of each project.
   * @param packages The packages to order.
   * @returns Returns the ordered packages.
   */
  private ordered(packages: readonly InstalledPackage[]): readonly InstalledPackage[] {
    const rank: Record<PackageUpdateStatus, number> = { outdated: 0, unknown: 1, current: 2 };
    return [...packages].sort((a: InstalledPackage, b: InstalledPackage): number => {
      const byStatus: number = rank[a.status] - rank[b.status];
      return byStatus !== 0 ? byStatus : a.name.localeCompare(b.name);
    });
  }
}
