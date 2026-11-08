import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  InputSignal,
  signal,
  Signal,
  WritableSignal,
} from '@angular/core';
import type { PackageManagerSummary, PackageWriteOp } from '@shared/api/package-channels';
import type {
  PackageProject,
  PackageSearchItem,
  PackageUpdateStatus,
} from '@shared/api/package-management';
import type { PackageManagerCapability } from '@shared/api/package-manager-protocol';
import { DockPanel } from '@shared/angular/services/dock-layout/dock-panel';
import { FileOpener } from '@shared/angular/services/file-opener/file-opener';
import { Log } from '@shared/angular/services/log/log';
import { Icon } from '@shared/angular/icons/icon';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Chip } from '@shared/angular/components/chip/chip';
import { Button } from '@shared/angular/components/forms/button/button';
import { Dropdown, DropdownOption } from '@shared/angular/components/forms/dropdown/dropdown';
import { TextField } from '@shared/angular/components/forms/text-field/text-field';
import { Toggle } from '@shared/angular/components/forms/toggle/toggle';
import { PanelStatus } from '@shared/angular/components/panel-status/panel-status';
import { PanelToolbar } from '@shared/angular/components/panel-toolbar/panel-toolbar';
import { PluginAction } from '@shared/angular/components/plugin-action/plugin-action';
import {
  Table,
  TableColumn,
  TableGroupDef,
  TableRow,
  TableRowDef,
  TableSort,
} from '@shared/angular/components/table/table';
import {
  PackageManagerState,
  PackageModel,
  PackageRow,
  PackageWrite,
} from '@features/workspace/angular/project/package-model';
import {
  ExploreSource,
  PackageExplorer,
} from '@features/workspace/angular/project/package-explorer';
import { WorkspaceGit } from '@features/workspace/angular/workspace-git/workspace-git';

/**
 * The panel's two modes: the installed dependencies of the workspace's projects, or exploring a
 * source's catalogue.
 */
type PackageMode = 'installed' | 'explore';

/**
 * The payload of a project group row.
 */
interface PackageGroupData {
  /**
   * Gets the project's display name.
   */
  readonly name: string;

  /**
   * Gets the absolute manifest path, opened when the group header is clicked.
   */
  readonly manifestPath: string;

  /**
   * Gets how many of the project's packages are outdated.
   */
  readonly outdated: number;

  /**
   * Gets the plugin that read the project.
   */
  readonly pluginId: string;

  /**
   * Gets that plugin's display name.
   */
  readonly manager: string;
}

/**
 * A package (data) row of the package model — the non-group variant of {@link PackageRow}, buffered
 * per project so a header sort reorders a project's packages without disturbing the projects.
 */
type PackageDataRow = Extract<PackageRow, { kind: 'package' }>;

/**
 * Maps each upgrade status to the icon shown on its package row.
 */
const STATUS_ICONS: Readonly<Record<PackageUpdateStatus, Icon>> = {
  current: Icon.CHECK,
  outdated: Icon.ARROW_UP,
  unknown: Icon.HINT,
};

/**
 * The Installed columns: the package name (flexing), its scope, the installed version, the latest the
 * registry offers, and the row's actions.
 */
const INSTALLED_COLUMNS: readonly TableColumn[] = [
  { id: 'name', header: 'Package', sortable: true },
  { id: 'scope', header: 'Scope', width: '7rem', sortable: true },
  { id: 'installed', header: 'Installed', width: '7rem', align: 'end' },
  { id: 'latest', header: 'Latest', width: '7rem', align: 'end' },
  { id: 'actions', header: '', width: '4.5rem', align: 'end' },
];

/**
 * The Explore columns (#912): Package · Description · Downloads · Version, and the row's Install.
 */
const EXPLORE_COLUMNS: readonly TableColumn[] = [
  { id: 'name', header: 'Package', width: '16rem', sortable: true },
  { id: 'description', header: 'Description' },
  { id: 'downloads', header: 'Downloads', width: '7rem', align: 'end', sortable: true },
  { id: 'version', header: 'Version', width: '7rem', align: 'end' },
  { id: 'actions', header: '', width: '3rem', align: 'end' },
];

/**
 * Renders the {@link PackageModel} and {@link PackageExplorer} as the body of the Packages dock panel
 * (#912), to the strip rules of #882: one tool strip with Installed · Explore, an Explore form on one
 * row beneath it, and a status strip of chips.
 *
 * Installed is one table grouped by project, whichever package manager read it, so the columns line up
 * across a folder holding an npm package and a .NET solution side by side; with several package
 * managers each project names its own. Explore lists the sources of every installed package manager
 * that can search, grouped by manager.
 *
 * Changes are made in the rows, as in the Plugin Manager: Update and Remove on a package, Restore on a
 * project, Install on a search result — each offered only where the plugin declared it can. What runs
 * is the command the plugin answered with, in a terminal the user can see and stop; the panel reads the
 * folder again when it ends.
 */
@Component({
  selector: 'app-packages-panel',
  imports: [
    Chip,
    Button,
    AppIcon,
    Dropdown,
    TextField,
    Toggle,
    PanelStatus,
    PanelToolbar,
    PluginAction,
    Table,
    TableRowDef,
    TableGroupDef,
  ],
  templateUrl: './packages-panel.html',
  styleUrl: './packages-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PackagesPanel {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the Installed table columns.
   */
  protected readonly installedColumns: readonly TableColumn[] = INSTALLED_COLUMNS;

  /**
   * Gets the Explore table columns.
   */
  protected readonly exploreColumns: readonly TableColumn[] = EXPLORE_COLUMNS;

  /**
   * Gets the dock panel descriptor this body renders. Supplied by the dock outlet; unused here because
   * the dock chrome renders the title.
   */
  public readonly panel: InputSignal<DockPanel> = input.required<DockPanel>();

  /**
   * Gets the installed package model rendered by this panel.
   */
  protected readonly packages: PackageModel = inject(PackageModel);

  /**
   * Gets the exploration model rendered by this panel.
   */
  protected readonly explorer: PackageExplorer = inject(PackageExplorer);

  /**
   * Holds the file opener used to open a project's manifest when its header is clicked.
   */
  private readonly fileOpener: FileOpener = inject(FileOpener);

  /**
   * Holds the structured logger for package panel actions.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the workspace's version-control binding, through which a repository is trusted; null outside
   * a workspace tab.
   */
  private readonly workspaceGit: WorkspaceGit | null = inject(WorkspaceGit, { optional: true });

  /**
   * Holds whether a trust is in progress.
   */
  protected readonly trusting: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds the active panel mode.
   */
  protected readonly mode: WritableSignal<PackageMode> = signal<PackageMode>('installed');

  /**
   * Holds the project an install goes into, as the user chose it, or null for the first.
   */
  protected readonly target: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Holds the active Installed sort, applied within each project group.
   */
  private readonly installedSort: WritableSignal<TableSort | null> = signal<TableSort | null>(null);

  /**
   * Holds the active Explore sort, applied client-side to the loaded results.
   */
  private readonly exploreSort: WritableSignal<TableSort | null> = signal<TableSort | null>(null);

  /**
   * Gets whether more than one package manager reads this folder, which is when each project names
   * the one that read it.
   */
  protected readonly several: Signal<boolean> = computed(
    (): boolean => this.packages.installed().length > 1,
  );

  /**
   * Gets the source options for the Explore picker, grouped by package manager when there are several.
   */
  protected readonly sourceOptions: Signal<readonly DropdownOption[]> = computed(
    (): readonly DropdownOption[] => {
      const grouped: boolean =
        new Set<string>(
          this.explorer.sources().map((source: ExploreSource): string => source.manager.pluginId),
        ).size > 1;
      return this.explorer.sources().map((source: ExploreSource): DropdownOption => ({
        value: source.key,
        label: source.name,
        ...(grouped ? { group: source.manager.displayName } : {}),
      }));
    },
  );

  /**
   * Gets the projects of the selected source's package manager, which an install can go into.
   */
  protected readonly targets: Signal<readonly PackageProject[]> = computed(
    (): readonly PackageProject[] => {
      const pluginId: string | undefined = this.explorer.selected()?.manager.pluginId;
      return (
        this.packages
          .states()
          .find((state: PackageManagerState): boolean => state.manager.pluginId === pluginId)?.model
          ?.projects ?? []
      );
    },
  );

  /**
   * Gets the install targets as picker options.
   */
  protected readonly targetOptions: Signal<readonly DropdownOption[]> = computed(
    (): readonly DropdownOption[] =>
      this.targets().map((project: PackageProject): DropdownOption => ({
        value: project.manifestPath,
        label: `Into ${project.name}`,
      })),
  );

  /**
   * Gets the project an install goes into: the one chosen, while it is still a target, or the first.
   */
  protected readonly installTarget: Signal<string | null> = computed((): string | null => {
    const chosen: string | null = this.target();
    const projects: readonly PackageProject[] = this.targets();
    return (
      projects.find((project: PackageProject): boolean => project.manifestPath === chosen)
        ?.manifestPath ??
      projects[0]?.manifestPath ??
      null
    );
  });

  /**
   * Gets whether the selected source's package manager can install.
   */
  protected readonly canInstall: Signal<boolean> = computed(
    (): boolean => this.explorer.selected()?.manager.capabilities.includes('install') === true,
  );

  /**
   * Gets the Install button's tooltip, naming where the package goes.
   */
  protected readonly installTooltip: Signal<string> = computed((): string => {
    const target: PackageProject | undefined = this.targets().find(
      (project: PackageProject): boolean => project.manifestPath === this.installTarget(),
    );
    return target === undefined ? 'No project to install into' : `Install into ${target.name}`;
  });

  /**
   * Gets the search field's placeholder, which says how the selected source answers: a registry with
   * no search looks one exact name up, and says so rather than pretending to search.
   */
  protected readonly searchPlaceholder: Signal<string> = computed((): string => {
    const source: string = this.explorer.selected()?.name ?? 'packages';
    switch (this.explorer.searchMode()) {
      case 'exact':
        return `Exact package name on ${source}`;
      case 'query':
        return `Search ${source}`;
      default:
        return `Search or browse ${source}`;
    }
  });

  /**
   * Gets what an empty field says for a source that needs text before it answers.
   */
  protected readonly promptText: Signal<string> = computed((): string => {
    const source: string = this.explorer.selected()?.name ?? 'this source';
    return this.explorer.searchMode() === 'exact'
      ? `${source} has no search. Type a package's exact name to look it up.`
      : `Type to search ${source}.`;
  });

  /**
   * Gets the sentence naming the package managers that cannot search their registries.
   */
  protected readonly unsearchableText: Signal<string> = computed((): string => {
    const names: string = this.explorer
      .unsearchable()
      .map((manager: PackageManagerSummary): string => manager.displayName)
      .join(', ');
    return `${names} cannot search its registry, so there is nothing to explore here.`;
  });

  /**
   * Gets why the installed package managers read nothing, when every one of them failed.
   */
  protected readonly failure: Signal<string | null> = computed((): string | null => {
    const states: readonly PackageManagerState[] = this.packages.states();
    const failed: readonly PackageManagerState[] = states.filter(
      (state: PackageManagerState): boolean => state.error !== null,
    );
    return failed.length > 0 && failed.length === states.length
      ? failed.map((state: PackageManagerState): string => state.error ?? '').join(' ')
      : null;
  });

  /**
   * Gets the Installed status strip's summary: how many packages in how many projects.
   */
  protected readonly summaryText: Signal<string> = computed((): string => {
    const projects: readonly PackageProject[] = this.packages
      .states()
      .flatMap(
        (state: PackageManagerState): readonly PackageProject[] => state.model?.projects ?? [],
      );
    const count: number = projects.reduce(
      (total: number, project: PackageProject): number => total + project.packages.length,
      0,
    );
    const packageWord: string = count === 1 ? 'package' : 'packages';
    const projectWord: string = projects.length === 1 ? 'project' : 'projects';
    return `${count} ${packageWord} in ${projects.length} ${projectWord}`;
  });

  /**
   * Gets the Installed rows adapted to the table's row shape: a project becomes a group header, its
   * packages data rows, sorted within each group.
   */
  protected readonly installedRows: Signal<readonly TableRow[]> = computed(
    (): readonly TableRow[] => {
      const sort: TableSort | null = this.installedSort();
      const result: TableRow[] = [];
      let buffer: PackageDataRow[] = [];
      const flush: () => void = (): void => {
        for (const row of this.sortInstalled(buffer, sort)) {
          result.push({ id: row.key, data: row });
        }
        buffer = [];
      };
      for (const row of this.packages.rows()) {
        if (row.kind === 'project') {
          flush();
          const data: PackageGroupData = {
            name: row.name,
            manifestPath: row.key,
            outdated: row.outdated,
            pluginId: row.pluginId,
            manager: row.manager,
          };
          result.push({ id: row.key, data, group: true });
        } else {
          buffer.push(row);
        }
      }
      flush();
      return result;
    },
  );

  /**
   * Gets the Explore rows: the loaded results, client-side sorted when a header sort is active.
   */
  protected readonly exploreRows: Signal<readonly TableRow[]> = computed((): readonly TableRow[] =>
    this.sortExplore(this.explorer.results(), this.exploreSort()).map(
      (item: PackageSearchItem): TableRow => ({
        id: `${item.sourceName}:${item.name}`,
        data: item,
      }),
    ),
  );

  /**
   * Switches the panel mode, loading the exploration sources the first time Explore is opened.
   * @param mode The mode to switch to.
   */
  protected setMode(mode: PackageMode): void {
    this.log.debug('workspace.packages', 'Switch package mode', mode);
    this.mode.set(mode);
    if (mode === 'explore') {
      void this.explorer.ensureSources();
    }
  }

  /**
   * Toggles the Installed outdated-only filter.
   */
  protected toggleOutdatedOnly(): void {
    this.packages.setOutdatedOnly(!this.packages.outdatedOnly());
  }

  /**
   * Reloads the installed model, re-resolving installed and latest versions.
   */
  protected refresh(): void {
    this.log.info('workspace.packages', 'Refresh installed packages requested');
    this.packages.refreshNow();
  }

  /**
   * Trusts the open folder, so its package managers may read it. A repository is trusted through
   * version control, so its panels fill too; any other folder has only this panel to be trusted from.
   * @returns Returns a promise that resolves once the folder has been read again.
   */
  protected async trustFolder(): Promise<void> {
    this.trusting.set(true);
    try {
      if (this.workspaceGit?.isRestricted() === true) {
        await this.workspaceGit.trustRepository();
        this.packages.refreshNow();
      } else {
        await this.packages.trustFolder();
      }
    } finally {
      this.trusting.set(false);
    }
  }

  /**
   * Determines whether a package manager declared it can make a change.
   * @param pluginId The plugin.
   * @param op The change.
   * @returns Returns true when the change is offered.
   */
  protected can(pluginId: string, op: PackageWriteOp): boolean {
    const capability: PackageManagerCapability = op;
    return (
      this.packages
        .installed()
        .find((manager: PackageManagerSummary): boolean => manager.pluginId === pluginId)
        ?.capabilities.includes(capability) ?? false
    );
  }

  /**
   * Updates a package to the latest version its registry offers.
   * @param row The package row.
   */
  protected update(row: PackageDataRow): void {
    void this.packages.write(row.pluginId, 'update', {
      project: row.project,
      name: row.package.name,
      version: row.package.latest,
    });
  }

  /**
   * Removes a package from its project. The command runs in a terminal the user can see and stop, and
   * the project's manifest is under their version control, so it asks no question first.
   * @param row The package row.
   */
  protected remove(row: PackageDataRow): void {
    void this.packages.write(row.pluginId, 'remove', {
      project: row.project,
      name: row.package.name,
    });
  }

  /**
   * Restores what a project declares. The click is the header's too, so it stops there rather than
   * also opening the manifest.
   * @param event The click.
   * @param group The project group.
   */
  protected restore(event: Event, group: PackageGroupData): void {
    event.stopPropagation();
    void this.packages.write(group.pluginId, 'restore', { project: group.manifestPath });
  }

  /**
   * Installs a search result into the chosen project, at the version the source listed.
   * @param item The search result.
   */
  protected install(item: PackageSearchItem): void {
    const pluginId: string | undefined = this.explorer.selected()?.manager.pluginId;
    const project: string | null = this.installTarget();
    if (pluginId === undefined || project === null) {
      return;
    }
    void this.packages.write(pluginId, 'install', {
      project,
      name: item.name,
      version: item.version.length > 0 ? item.version : null,
    });
  }

  /**
   * Determines whether a package row is the one a running change is about.
   * @param row The package row.
   * @returns Returns true when it is.
   */
  protected isWriting(row: PackageDataRow): boolean {
    const writing: PackageWrite | null = this.packages.writing();
    return (
      writing !== null &&
      writing.pluginId === row.pluginId &&
      writing.request.project === row.project &&
      writing.request.name === row.package.name
    );
  }

  /**
   * Determines whether a search result is being installed.
   * @param item The search result.
   * @returns Returns true when it is.
   */
  protected isInstalling(item: PackageSearchItem): boolean {
    const writing: PackageWrite | null = this.packages.writing();
    return writing !== null && writing.op === 'install' && writing.request.name === item.name;
  }

  /**
   * Handles a table row click: opens the manifest of a project group header.
   * @param row The clicked table row.
   */
  protected onRowClick(row: TableRow): void {
    if (row.group === true) {
      const manifestPath: string = (row.data as PackageGroupData).manifestPath;
      this.log.info('workspace.packages', 'Open project manifest', manifestPath);
      void this.fileOpener.openPath(manifestPath);
    }
  }

  /**
   * Records the Installed header sort.
   * @param sort The new sort, or null when cleared.
   */
  protected onInstalledSort(sort: TableSort | null): void {
    this.installedSort.set(sort);
  }

  /**
   * Records the Explore header sort.
   * @param sort The new sort, or null when cleared.
   */
  protected onExploreSort(sort: TableSort | null): void {
    this.exploreSort.set(sort);
  }

  /**
   * Reads a group row's payload for the template.
   * @param row The group table row.
   * @returns Returns the project group data.
   */
  protected group(row: TableRow): PackageGroupData {
    return row.data as PackageGroupData;
  }

  /**
   * Reads an Installed data row's payload for the template.
   * @param row The package table row.
   * @returns Returns the package row.
   */
  protected pkg(row: TableRow): PackageDataRow {
    return row.data as PackageDataRow;
  }

  /**
   * Reads an Explore data row's payload for the template.
   * @param row The result table row.
   * @returns Returns the search result item.
   */
  protected item(row: TableRow): PackageSearchItem {
    return row.data as PackageSearchItem;
  }

  /**
   * Resolves the icon for an upgrade status.
   * @param status The upgrade status.
   * @returns Returns the status icon.
   */
  protected iconFor(status: PackageUpdateStatus): Icon {
    return STATUS_ICONS[status];
  }

  /**
   * Formats a download count compactly (for example `12.3M`), or an em dash when unknown.
   * @param downloads The download count, or null.
   * @returns Returns the formatted count.
   */
  protected formatDownloads(downloads: number | null): string {
    if (downloads === null) {
      return '—';
    }
    if (downloads >= 1_000_000) {
      return `${(downloads / 1_000_000).toFixed(1)}M`;
    }
    if (downloads >= 1_000) {
      return `${(downloads / 1_000).toFixed(1)}K`;
    }
    return String(downloads);
  }

  /**
   * Orders a project's package rows by the active Installed sort, or returns them untouched.
   * @param rows The project's package rows.
   * @param sort The active sort, or null.
   * @returns Returns the ordered rows.
   */
  private sortInstalled(
    rows: readonly PackageDataRow[],
    sort: TableSort | null,
  ): readonly PackageDataRow[] {
    if (sort === null) {
      return rows;
    }
    const key: (row: PackageDataRow) => string =
      sort.columnId === 'scope'
        ? (row: PackageDataRow): string => row.package.scope
        : (row: PackageDataRow): string => row.package.name;
    const factor: number = sort.direction === 'asc' ? 1 : -1;
    return [...rows].sort(
      (a: PackageDataRow, b: PackageDataRow): number => key(a).localeCompare(key(b)) * factor,
    );
  }

  /**
   * Orders the loaded Explore results by the active sort (by name or downloads), or returns the source's
   * own order when there is no sort.
   * @param items The loaded results.
   * @param sort The active sort, or null.
   * @returns Returns the ordered items.
   */
  private sortExplore(
    items: readonly PackageSearchItem[],
    sort: TableSort | null,
  ): readonly PackageSearchItem[] {
    if (sort === null) {
      return items;
    }
    const factor: number = sort.direction === 'asc' ? 1 : -1;
    return [...items].sort((a: PackageSearchItem, b: PackageSearchItem): number =>
      sort.columnId === 'downloads'
        ? ((a.downloads ?? 0) - (b.downloads ?? 0)) * factor
        : a.name.localeCompare(b.name) * factor,
    );
  }
}
