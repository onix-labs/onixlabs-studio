import { computed, effect, inject, Service, signal, Signal, WritableSignal } from '@angular/core';
import { Bridge } from '@shared/api/bridge';
import {
  PackageAnswer,
  PackageChannel,
  PackageManagerSummary,
  PackageWorkspaceStatus,
} from '@shared/api/package-channels';
import {
  InstalledPackage,
  PackageManagerModel,
  PackageProject,
  PackageUpdateStatus,
} from '@shared/api/package-management';
import type { RepositoryTrustDecision } from '@shared/api/source-control-channels';
import type { PluginContribution, PluginSummary } from '@shared/api/plugin-channels';
import { Plugins } from '@shared/angular/services/plugins/plugins';
import { RepositoryTrust } from '@shared/angular/services/repository-trust/repository-trust';
import { Workspace } from '@shared/angular/services/workspace/workspace';
import { Log } from '@shared/angular/services/log/log';

/**
 * A flattened Packages row: either a project header or one of its packages, with its display fields
 * resolved so the panel renders it directly.
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

      /**
       * Holds the plugin that read the project.
       */
      readonly pluginId: string;

      /**
       * Holds that plugin's display name, such as `npm`.
       */
      readonly manager: string;
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

      /**
       * Holds the plugin that read the package's project.
       */
      readonly pluginId: string;

      /**
       * Holds the manifest of the project the package belongs to.
       */
      readonly project: string;
    };

/**
 * Describes one installed package manager's part of the panel: what it read, or why it read nothing.
 */
export interface PackageManagerState {
  /**
   * Gets the package manager.
   */
  readonly manager: PackageManagerSummary;

  /**
   * Gets what it read, or null while it loads, when it found nothing or when it failed.
   */
  readonly model: PackageManagerModel | null;

  /**
   * Gets why it read nothing, or null when it did not fail.
   */
  readonly error: string | null;

  /**
   * Gets whether its read is in flight.
   */
  readonly loading: boolean;
}

/**
 * Holds and drives this tab's Packages model (#911). Every package manager is a plugin, so the model
 * first asks which apply to the open root — installed or only offered — and whether the user trusts
 * the folder, then asks each installed one for its projects and their packages. With nothing installed
 * there is nothing to read: the panel offers the plugin instead, and with nothing contributed for the
 * folder at all it is not shown. Provided per directory tab; outside Electron everything stays empty.
 */
@Service()
export class PackageModel {
  /**
   * Holds this tab's workspace, whose root the model is built for.
   */
  private readonly workspace: Workspace = inject(Workspace);

  /**
   * Holds the installed plugins, so an install or removal is seen without reopening the folder.
   */
  private readonly plugins: Plugins = inject(Plugins);

  /**
   * Holds the repository-trust question, so a folder trusted from it is read straight away.
   */
  private readonly repositoryTrust: RepositoryTrust = inject(RepositoryTrust);

  /**
   * Holds the structured logger for the package model.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the generic transport, or undefined when running outside Electron.
   */
  private readonly bridge: Bridge | undefined = window.bridge;

  /**
   * Holds which package managers apply to the root and whether it is trusted, or null before asking.
   */
  private readonly statusSignal: WritableSignal<PackageWorkspaceStatus | null> =
    signal<PackageWorkspaceStatus | null>(null);

  /**
   * Holds each installed package manager's part, in priority order.
   */
  private readonly statesSignal: WritableSignal<readonly PackageManagerState[]> = signal<
    readonly PackageManagerState[]
  >([]);

  /**
   * Holds whether the row list is filtered to outdated packages only.
   */
  private readonly outdatedOnlySignal: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds the generation of the current refresh, so a stale one (the root changed while it was in
   * flight) does not apply its results.
   */
  private generation: number = 0;

  /**
   * Gets which package managers apply to the root and whether it is trusted, or null before asking.
   */
  public readonly status: Signal<PackageWorkspaceStatus | null> = this.statusSignal.asReadonly();

  /**
   * Gets each installed package manager's part, in priority order.
   */
  public readonly states: Signal<readonly PackageManagerState[]> = this.statesSignal.asReadonly();

  /**
   * Gets whether the row list is filtered to outdated packages only.
   */
  public readonly outdatedOnly: Signal<boolean> = this.outdatedOnlySignal.asReadonly();

  /**
   * Gets whether the Packages panel has anything to say for this root: a package manager applies to
   * it, installed or only offered. With none, the panel is not shown at all.
   */
  public readonly available: Signal<boolean> = computed(
    (): boolean => (this.statusSignal()?.managers.length ?? 0) > 0,
  );

  /**
   * Gets the trust decision in force for the root.
   */
  public readonly trust: Signal<RepositoryTrustDecision> = computed(
    (): RepositoryTrustDecision => this.statusSignal()?.trust ?? 'unknown',
  );

  /**
   * Gets the installed package managers that apply to the root.
   */
  public readonly installed: Signal<readonly PackageManagerSummary[]> = computed(
    (): readonly PackageManagerSummary[] =>
      (this.statusSignal()?.managers ?? []).filter(
        (manager: PackageManagerSummary): boolean => manager.installed,
      ),
  );

  /**
   * Gets the plugins that would read this root but are not installed, as the Plugin Manager knows
   * them, so the panel can offer the Plugin Manager's own Install.
   */
  public readonly offered: Signal<readonly PluginSummary[]> = computed(
    (): readonly PluginSummary[] => {
      const wanted: ReadonlySet<string> = new Set<string>(
        (this.statusSignal()?.managers ?? [])
          .filter((manager: PackageManagerSummary): boolean => !manager.installed)
          .map((manager: PackageManagerSummary): string => manager.pluginId),
      );
      return this.plugins
        .plugins()
        .filter(
          (plugin: PluginSummary): boolean =>
            plugin.state !== 'installed' &&
            plugin.contributions.some(
              (contribution: PluginContribution): boolean =>
                contribution.slot === 'package-manager' && wanted.has(contribution.id),
            ),
        );
    },
  );

  /**
   * Gets whether any installed package manager is still reading.
   */
  public readonly loading: Signal<boolean> = computed(
    (): boolean =>
      this.statusSignal() === null ||
      this.statesSignal().some((state: PackageManagerState): boolean => state.loading),
  );

  /**
   * Gets whether any installed package manager read something.
   */
  public readonly hasModels: Signal<boolean> = computed((): boolean =>
    this.statesSignal().some((state: PackageManagerState): boolean => state.model !== null),
  );

  /**
   * Gets the total number of outdated packages across every package manager and project.
   */
  public readonly outdatedCount: Signal<number> = computed((): number =>
    this.statesSignal().reduce(
      (total: number, state: PackageManagerState): number =>
        total +
        (state.model?.projects ?? []).reduce(
          (sum: number, project: PackageProject): number => sum + outdatedIn(project),
          0,
        ),
      0,
    ),
  );

  /**
   * Gets the flattened, visible rows: a header per project, each followed by its packages, filtered to
   * the outdated ones while the outdated-only filter is on. Projects with no visible packages are
   * dropped. Package managers follow each other in priority order.
   */
  public readonly rows: Signal<readonly PackageRow[]> = computed((): readonly PackageRow[] => {
    const outdatedOnly: boolean = this.outdatedOnlySignal();
    const rows: PackageRow[] = [];
    for (const state of this.statesSignal()) {
      for (const project of state.model?.projects ?? []) {
        const visible: readonly InstalledPackage[] = outdatedOnly
          ? project.packages.filter(
              (entry: InstalledPackage): boolean => entry.status === 'outdated',
            )
          : project.packages;
        if (visible.length === 0) {
          continue;
        }
        rows.push({
          kind: 'project',
          key: project.manifestPath,
          name: project.name,
          outdated: outdatedIn(project),
          pluginId: state.manager.pluginId,
          manager: state.manager.displayName,
        });
        for (const entry of ordered(visible)) {
          rows.push({
            kind: 'package',
            key: `${project.manifestPath}:${entry.name}`,
            package: entry,
            pluginId: state.manager.pluginId,
            project: project.manifestPath,
          });
        }
      }
    }
    return rows;
  });

  /**
   * Gets the installed package-manager plugins and their versions as one key, so an install, update or
   * removal is noticed and the root asked again.
   */
  private readonly installedKey: Signal<string> = computed((): string =>
    this.plugins
      .plugins()
      .filter(
        (plugin: PluginSummary): boolean =>
          plugin.state === 'installed' &&
          plugin.contributions.some(
            (contribution: PluginContribution): boolean => contribution.slot === 'package-manager',
          ),
      )
      .map((plugin: PluginSummary): string => `${plugin.id}@${plugin.installedVersion ?? ''}`)
      .sort()
      .join(','),
  );

  /**
   * Initializes a new instance of the {@link PackageModel} class, refreshing whenever the open root
   * changes, a package-manager plugin is installed or removed, or a trust question is answered.
   */
  public constructor() {
    effect((): void => {
      const root: string | null = this.workspace.root()?.path ?? null;
      this.installedKey();
      void this.refresh(root);
    });
    let asking: boolean = false;
    effect((): void => {
      // A repository's trust is asked in a window of its own; once it is answered, ask again.
      const pending: boolean = this.repositoryTrust.pending() !== null;
      if (asking && !pending) {
        this.refreshNow();
      }
      asking = pending;
    });
  }

  /**
   * Sets whether the row list is filtered to outdated packages only.
   * @param value Whether to show outdated packages only.
   */
  public setOutdatedOnly(value: boolean): void {
    this.log.debug('workspace.packages', 'Set outdated-only filter', value);
    this.outdatedOnlySignal.set(value);
  }

  /**
   * Reloads everything for the current root, re-resolving installed and latest versions.
   */
  public refreshNow(): void {
    this.log.info('workspace.packages', 'Reload package model requested');
    void this.refresh(this.workspace.root()?.path ?? null);
  }

  /**
   * Trusts the open folder, from the panel, so its package managers may read it.
   * @returns Returns a promise that resolves once the folder has been asked about again.
   */
  public async trustFolder(): Promise<void> {
    const root: string | null = this.workspace.root()?.path ?? null;
    if (this.bridge === undefined || root === null) {
      return;
    }
    this.log.info('workspace.packages', 'Trust folder for package managers', root);
    await this.bridge.invoke<RepositoryTrustDecision>(PackageChannel.TrustFolder, root);
    await this.refresh(root);
  }

  /**
   * Asks which package managers apply to a root, then has each installed one read it. A stale answer
   * (the root changed again while it was on its way) is discarded.
   * @param root The workspace root, or null when none is open.
   * @returns Returns a promise that resolves once every installed manager has answered.
   */
  private async refresh(root: string | null): Promise<void> {
    const generation: number = ++this.generation;
    if (this.bridge === undefined || root === null) {
      this.statusSignal.set({ managers: [], trust: 'unknown' });
      this.statesSignal.set([]);
      return;
    }
    const bridge: Bridge = this.bridge;
    const status: PackageWorkspaceStatus = await bridge.invoke<PackageWorkspaceStatus>(
      PackageChannel.Managers,
      root,
    );
    if (generation !== this.generation) {
      return;
    }
    this.statusSignal.set(status);
    const installed: readonly PackageManagerSummary[] = status.managers.filter(
      (manager: PackageManagerSummary): boolean => manager.installed,
    );
    if (status.trust !== 'trusted' || installed.length === 0) {
      this.statesSignal.set([]);
      return;
    }
    this.statesSignal.set(
      installed.map((manager: PackageManagerSummary): PackageManagerState => ({
        manager,
        model: null,
        error: null,
        loading: true,
      })),
    );
    await Promise.all(
      installed.map(async (manager: PackageManagerSummary): Promise<void> => {
        const answer: PackageAnswer<PackageManagerModel | null> = await bridge.invoke<
          PackageAnswer<PackageManagerModel | null>
        >(PackageChannel.ModelLoad, root, manager.pluginId);
        if (generation !== this.generation) {
          return;
        }
        if (!answer.ok) {
          this.log.warn('workspace.packages', `${manager.pluginId} read nothing`, answer.error);
        }
        this.statesSignal.update(
          (states: readonly PackageManagerState[]): readonly PackageManagerState[] =>
            states.map((state: PackageManagerState): PackageManagerState =>
              state.manager.pluginId === manager.pluginId
                ? {
                    manager,
                    model: answer.ok ? answer.result : null,
                    error: answer.ok ? null : answer.error,
                    loading: false,
                  }
                : state,
            ),
        );
      }),
    );
  }
}

/**
 * Counts a project's outdated packages.
 * @param project The project.
 * @returns Returns how many have a newer version.
 */
function outdatedIn(project: PackageProject): number {
  return project.packages.filter((entry: InstalledPackage): boolean => entry.status === 'outdated')
    .length;
}

/**
 * Orders a run of packages for display: outdated first (the actionable ones), then by name, so the
 * upgrades a developer cares about sit at the top of each project.
 * @param packages The packages to order.
 * @returns Returns the ordered packages.
 */
function ordered(packages: readonly InstalledPackage[]): readonly InstalledPackage[] {
  const rank: Record<PackageUpdateStatus, number> = { outdated: 0, unknown: 1, current: 2 };
  return [...packages].sort((a: InstalledPackage, b: InstalledPackage): number => {
    const byStatus: number = rank[a.status] - rank[b.status];
    return byStatus !== 0 ? byStatus : a.name.localeCompare(b.name);
  });
}
