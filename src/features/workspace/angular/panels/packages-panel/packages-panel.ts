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
import {
  InstalledPackage,
  PackageSearchItem,
  PackageUpdateStatus,
} from '@shared/api/package-management';
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
import { PanelToolbar } from '@shared/angular/components/panel-toolbar/panel-toolbar';
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
} from '@features/workspace/angular/project/package-model';
import {
  ExploreSource,
  PackageExplorer,
} from '@features/workspace/angular/project/package-explorer';
import { PackageManagerSummary } from '@shared/api/package-channels';
import { PluginAction } from '@shared/angular/components/plugin-action/plugin-action';
import { WorkspaceGit } from '@features/workspace/angular/workspace-git/workspace-git';

/**
 * The panel's two modes: the installed dependencies of the workspace's projects, or exploring a
 * source's catalogue.
 */
type PackageMode = 'installed' | 'explore';

/**
 * The payload of a project group row: the project's name, the manifest to open on click, and how many
 * of its packages are outdated.
 */
interface PackageGroupData {
  /**
   * Gets the project's display name.
   */
  readonly name: string;

  /**
   * Gets the absolute manifest path opened when the group header is clicked.
   */
  readonly manifestPath: string;

  /**
   * Gets how many of the project's packages are outdated.
   */
  readonly outdated: number;
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
 * The Installed-mode columns: the package name (flexing), its scope, the installed version, and the
 * latest the registry offers.
 */
const INSTALLED_COLUMNS: readonly TableColumn[] = [
  { id: 'name', header: 'Package', sortable: true },
  { id: 'scope', header: 'Scope', width: '6rem', sortable: true },
  { id: 'installed', header: 'Installed', width: '7rem', align: 'end' },
  { id: 'latest', header: 'Latest', width: '7rem', align: 'end' },
];

/**
 * The Explore-mode columns: the package name, its latest version, download count, and description.
 */
const EXPLORE_COLUMNS: readonly TableColumn[] = [
  { id: 'name', header: 'Package', width: '18rem', sortable: true },
  { id: 'version', header: 'Version', width: '7rem', align: 'end' },
  { id: 'downloads', header: 'Downloads', width: '7rem', align: 'end', sortable: true },
  { id: 'description', header: 'Description' },
];

/**
 * Renders the {@link PackageModel} and {@link PackageExplorer} as the body of the Package Management
 * dock panel, with two modes. Installed: a collapsible {@link Table} grouped by project, each package
 * showing its scope, installed version, and the latest with an upgrade badge. Explore: a source picker,
 * a debounced search box, and a prerelease toggle over a table of the source's packages (browse with an
 * empty query — a private feed's full catalogue, or a public registry's popular listing). Read-only —
 * it visualises and browses; it does not install or modify anything.
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
    PanelToolbar,
    Table,
    TableRowDef,
    TableGroupDef,
    PluginAction,
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
   * Gets the Installed-mode table columns.
   */
  protected readonly installedColumns: readonly TableColumn[] = INSTALLED_COLUMNS;

  /**
   * Gets the Explore-mode table columns.
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
   * Holds the active Installed-mode sort, applied within each project group.
   */
  private readonly installedSort: WritableSignal<TableSort | null> = signal<TableSort | null>(null);

  /**
   * Holds the active Explore-mode sort, applied client-side to the loaded results.
   */
  private readonly exploreSort: WritableSignal<TableSort | null> = signal<TableSort | null>(null);

  /**
   * Gets the source options for the Explore picker.
   */
  protected readonly sourceOptions: Signal<readonly DropdownOption[]> = computed(
    (): readonly DropdownOption[] =>
      this.explorer.sources().map((source: ExploreSource): DropdownOption => ({
        value: source.key,
        label: source.name,
      })),
  );

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
        return `Type to search ${source}.`;
      default:
        return 'Search packages';
    }
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
   * Gets the Installed-mode rows adapted to the table's row shape: a project becomes a group header
   * carrying its manifest and outdated count, its packages become data rows, sorted within each group.
   */
  protected readonly installedRows: Signal<readonly TableRow[]> = computed(
    (): readonly TableRow[] => {
      const sort: TableSort | null = this.installedSort();
      const result: TableRow[] = [];
      let buffer: PackageDataRow[] = [];
      const flush: () => void = (): void => {
        for (const row of this.sortInstalled(buffer, sort)) {
          result.push({ id: row.key, data: row.package });
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
   * Gets the Explore-mode rows: the loaded results, client-side sorted when a header sort is active.
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
   * Toggles the Installed-mode outdated-only filter.
   */
  protected toggleOutdatedOnly(): void {
    this.packages.setOutdatedOnly(!this.packages.outdatedOnly());
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
   * Reloads the installed model, re-resolving installed and latest versions.
   */
  protected refresh(): void {
    this.log.info('workspace.packages', 'Refresh installed packages requested');
    this.packages.refreshNow();
  }

  /**
   * Handles a table row click: in Installed mode, opens the manifest of a project group header.
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
   * Records the Installed-mode header sort.
   * @param sort The new sort, or null when cleared.
   */
  protected onInstalledSort(sort: TableSort | null): void {
    this.installedSort.set(sort);
  }

  /**
   * Records the Explore-mode header sort.
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
   * Reads an Installed-mode data row's payload for the template.
   * @param row The package table row.
   * @returns Returns the package.
   */
  protected pkg(row: TableRow): InstalledPackage {
    return row.data as InstalledPackage;
  }

  /**
   * Reads an Explore-mode data row's payload for the template.
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
   * Orders a project's package rows by the active Installed-mode sort, or returns them untouched.
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
