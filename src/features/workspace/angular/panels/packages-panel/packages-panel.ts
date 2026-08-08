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
import { InstalledPackage, PackageUpdateStatus } from '@shared/api/package-management';
import { DockPanel } from '@shared/angular/services/dock-layout/dock-panel';
import { FileOpener } from '@shared/angular/services/file-opener/file-opener';
import { Icon } from '@shared/angular/icons/icon';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Button } from '@shared/angular/components/forms/button/button';
import { PanelToolbar } from '@shared/angular/components/panel-toolbar/panel-toolbar';
import {
  Table,
  TableColumn,
  TableGroupDef,
  TableRow,
  TableRowDef,
  TableSort,
} from '@shared/angular/components/table/table';
import { PackageModel, PackageRow } from '@features/workspace/angular/project/package-model';

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
 * The table columns: the package name (flexing), its scope, the installed version, and the latest the
 * registry offers.
 */
const COLUMNS: readonly TableColumn[] = [
  { id: 'name', header: 'Package', sortable: true },
  { id: 'scope', header: 'Scope', width: '6rem', sortable: true },
  { id: 'installed', header: 'Installed', width: '7rem', align: 'end' },
  { id: 'latest', header: 'Latest', width: '7rem', align: 'end' },
];

/**
 * Renders the {@link PackageModel} as the body of the Package Management dock panel: a tool-strip that
 * toggles an outdated-only filter and refreshes the model, over a {@link Table} whose header stays fixed
 * while the body scrolls. Each project is a group header (click to open its manifest, with an outdated
 * badge); each package is a data row showing its scope, installed version, and the latest the registry
 * offers with an upgrade badge. Read-only — it visualises dependency and upgrade state; it does not
 * install or modify anything.
 */
@Component({
  selector: 'app-packages-panel',
  imports: [Button, AppIcon, PanelToolbar, Table, TableRowDef, TableGroupDef],
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
   * Gets the table columns, exposed for the template.
   */
  protected readonly columns: readonly TableColumn[] = COLUMNS;

  /**
   * Gets the dock panel descriptor this body renders. Supplied by the dock outlet; unused here because
   * the dock chrome renders the title.
   */
  public readonly panel: InputSignal<DockPanel> = input.required<DockPanel>();

  /**
   * Gets the package model rendered by this panel.
   */
  protected readonly packages: PackageModel = inject(PackageModel);

  /**
   * Holds the file opener used to open a project's manifest when its header is clicked.
   */
  private readonly fileOpener: FileOpener = inject(FileOpener);

  /**
   * Holds the active header sort, or null when unsorted. Applied within each project group, so sorting
   * reorders a project's packages without shuffling the projects themselves.
   */
  private readonly activeSort: WritableSignal<TableSort | null> = signal<TableSort | null>(null);

  /**
   * Gets the model's flattened rows adapted to the table's row shape: a project becomes a group header
   * carrying its manifest and outdated count, and its packages become data rows. When a header sort is
   * active it reorders each project's packages by the chosen column; otherwise the model's own order
   * (outdated first) is kept.
   */
  protected readonly tableRows: Signal<readonly TableRow[]> = computed((): readonly TableRow[] => {
    const sort: TableSort | null = this.activeSort();
    const result: TableRow[] = [];
    let buffer: PackageDataRow[] = [];
    const flush: () => void = (): void => {
      for (const row of this.sortPackages(buffer, sort)) {
        result.push({ id: row.key, data: row.package });
      }
      buffer = [];
    };
    for (const row of this.packages.rows()) {
      if (row.kind === 'project') {
        flush();
        const data: PackageGroupData = { name: row.name, manifestPath: row.key, outdated: row.outdated };
        result.push({ id: row.key, data, group: true });
      } else {
        buffer.push(row);
      }
    }
    flush();
    return result;
  });

  /**
   * Toggles the outdated-only filter.
   */
  protected toggleOutdatedOnly(): void {
    this.packages.setOutdatedOnly(!this.packages.outdatedOnly());
  }

  /**
   * Reloads the model, re-resolving installed and latest versions.
   */
  protected refresh(): void {
    this.packages.refreshNow();
  }

  /**
   * Records the header sort chosen in the table, so the rows recompute in the new order.
   * @param sort The new sort, or null when sorting is cleared.
   */
  protected onSortChange(sort: TableSort | null): void {
    this.activeSort.set(sort);
  }

  /**
   * Orders a project's package rows by the active sort — by package name or scope — or returns them
   * untouched (the model's outdated-first order) when there is no sort.
   * @param rows The project's package rows.
   * @param sort The active sort, or null.
   * @returns Returns the ordered rows.
   */
  private sortPackages(
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
   * Handles a table row click: opens the manifest of a project group header; a package row does
   * nothing.
   * @param row The clicked table row.
   */
  protected onRowClick(row: TableRow): void {
    if (row.group === true) {
      void this.fileOpener.openPath((row.data as PackageGroupData).manifestPath);
    }
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
   * Reads a data row's payload for the template.
   * @param row The package table row.
   * @returns Returns the package.
   */
  protected pkg(row: TableRow): InstalledPackage {
    return row.data as InstalledPackage;
  }

  /**
   * Resolves the icon for an upgrade status.
   * @param status The upgrade status.
   * @returns Returns the status icon.
   */
  protected iconFor(status: PackageUpdateStatus): Icon {
    return STATUS_ICONS[status];
  }
}
