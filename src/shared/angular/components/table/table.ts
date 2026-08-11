import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  contentChild,
  Directive,
  inject,
  input,
  InputSignal,
  output,
  OutputEmitterRef,
  signal,
  Signal,
  TemplateRef,
  WritableSignal,
} from '@angular/core';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Icon } from '@shared/angular/icons/icon';

/**
 * How a column's header and cells are horizontally aligned.
 */
export type TableAlign = 'start' | 'center' | 'end';

/**
 * Describes one column of a {@link Table}: the header it renders and how it is sized and aligned. The
 * consumer's cell template is responsible for rendering the matching cell content in the same column
 * order.
 */
export interface TableColumn {
  /**
   * Gets the column's stable identity, used as the render key.
   */
  readonly id: string;

  /**
   * Gets the header text shown in the fixed header row.
   */
  readonly header: string;

  /**
   * Gets the column's CSS width (for example `40%` or `6rem`), or absent to let it take the remaining
   * space. The table lays columns out with a fixed algorithm, so a stated width is honoured exactly and
   * the header and body stay aligned.
   */
  readonly width?: string;

  /**
   * Gets the column's horizontal alignment. Defaults to `start`.
   */
  readonly align?: TableAlign;

  /**
   * Gets an optional tooltip shown on the column header.
   */
  readonly headerTooltip?: string;

  /**
   * Gets whether the column's header can be clicked to sort by it. A sortable header cycles through
   * ascending, descending, and unsorted; a non-sortable header is inert. The table only reports the
   * sort through {@link Table.sortChange} — the consumer owns its data and applies the ordering.
   * Defaults to false.
   */
  readonly sortable?: boolean;
}

/**
 * The direction a column is sorted in.
 */
export type TableSortDirection = 'asc' | 'desc';

/**
 * A sort selection: the column being sorted and its direction.
 */
export interface TableSort {
  /**
   * Gets the id of the sorted column.
   */
  readonly columnId: string;

  /**
   * Gets the sort direction.
   */
  readonly direction: TableSortDirection;
}

/**
 * Describes one row of a {@link Table}: its identity, the consumer's payload (read by the projected
 * templates), and whether it is a full-width group header rather than a data row.
 */
export interface TableRow {
  /**
   * Gets the row's stable identity, used for tracking.
   */
  readonly id: string;

  /**
   * Gets the consumer's payload for the row, read by the projected cell or group template.
   */
  readonly data: unknown;

  /**
   * Gets whether the row is a full-width group header (spanning every column) rather than a data row.
   * A group row is rendered through the {@link TableGroupDef} template; a data row through the
   * {@link TableRowDef} template. Defaults to false.
   */
  readonly group?: boolean;
}

/**
 * Marks the `<ng-template>` a {@link Table} renders for each data row. The row is the template's
 * implicit context (`<ng-template appTableRow let-row>`), and the template must render one `<td>` per
 * column in column order.
 */
@Directive({ selector: '[appTableRow]' })
export class TableRowDef {
  /**
   * Gets the marked template, rendered once per data row.
   */
  public readonly template: TemplateRef<unknown> = inject<TemplateRef<unknown>>(TemplateRef);
}

/**
 * Marks the `<ng-template>` a {@link Table} renders for each group header row. The row is the
 * template's implicit context (`<ng-template appTableGroup let-row>`), and the table wraps its content
 * in a single cell spanning every column.
 */
@Directive({ selector: '[appTableGroup]' })
export class TableGroupDef {
  /**
   * Gets the marked template, rendered once per group header row.
   */
  public readonly template: TemplateRef<unknown> = inject<TemplateRef<unknown>>(TemplateRef);
}

/**
 * A reusable table presenter whose header stays fixed while the body scrolls. It owns the structural
 * concerns — a single real `<table>` laid out with a fixed algorithm (so the header and body columns
 * always align), a scrolling body under a header row pinned with `position: sticky`, hover chrome, and
 * an optional empty state — while each consumer supplies its {@link TableColumn}s and projects the cell
 * markup through two templates: {@link TableRowDef} (`*appTableRow`) for each data row's `<td>`s, and
 * an optional {@link TableGroupDef} (`*appTableGroup`) for a full-width group header row. Clicking any
 * row emits {@link rowClick}; the consumer decides what that means.
 */
@Component({
  selector: 'app-table',
  imports: [NgTemplateOutlet, AppIcon],
  templateUrl: './table.html',
  styleUrl: './table.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Table {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the columns rendered in the fixed header, in order.
   */
  public readonly columns: InputSignal<readonly TableColumn[]> =
    input.required<readonly TableColumn[]>();

  /**
   * Gets the rows to render in order — data rows and group headers interleaved.
   */
  public readonly rows: InputSignal<readonly TableRow[]> = input.required<readonly TableRow[]>();

  /**
   * Gets the text shown when there are no rows, or an empty string to show nothing.
   */
  public readonly emptyText: InputSignal<string> = input<string>('');

  /**
   * Gets whether group rows can be collapsed. When on, each group row grows a leading twisty that
   * hides or reveals the data rows beneath it (up to the next group), turning the table into a grouped,
   * tree-like surface that still keeps its column headers. Defaults to false.
   */
  public readonly collapsible: InputSignal<boolean> = input<boolean>(false);

  /**
   * Gets the ids of the currently-selected rows, highlighted in the table. Selection is driven by the
   * consumer (typically from {@link rowClick}); defaults to none. Purely visual — the table does not
   * manage the set.
   */
  public readonly selectedIds: InputSignal<ReadonlySet<string>> = input<ReadonlySet<string>>(
    new Set<string>(),
  );

  /**
   * Emits the row that was clicked.
   */
  public readonly rowClick: OutputEmitterRef<TableRow> = output<TableRow>();

  /**
   * Emits the current sort whenever a sortable header is clicked, or null when sorting is cleared (the
   * third click of a column returns it to unsorted). The consumer applies the ordering to its rows.
   */
  public readonly sortChange: OutputEmitterRef<TableSort | null> = output<TableSort | null>();

  /**
   * Holds the active sort, or null when unsorted. Drives the header indicator; the consumer applies the
   * ordering it is told about through {@link sortChange}.
   */
  private readonly currentSort: WritableSignal<TableSort | null> = signal<TableSort | null>(null);

  /**
   * Gets the active sort, or null when unsorted, exposed so the header can render its indicator.
   */
  protected readonly sort: Signal<TableSort | null> = this.currentSort.asReadonly();

  /**
   * Holds the ids of the currently collapsed group rows. Keyed by row id, so the collapse state
   * survives the row list recomputing (a refresh or a re-sort).
   */
  private readonly collapsedGroups: WritableSignal<ReadonlySet<string>> = signal<ReadonlySet<string>>(
    new Set<string>(),
  );

  /**
   * Gets the rows actually rendered: every row when not collapsible, otherwise every group row plus the
   * data rows of the groups that are expanded (a collapsed group's data rows — those up to the next
   * group — are dropped).
   */
  protected readonly visibleRows: Signal<readonly TableRow[]> = computed(
    (): readonly TableRow[] => {
      if (!this.collapsible()) {
        return this.rows();
      }
      const collapsed: ReadonlySet<string> = this.collapsedGroups();
      const visible: TableRow[] = [];
      let hidden: boolean = false;
      for (const row of this.rows()) {
        if (row.group === true) {
          hidden = collapsed.has(row.id);
          visible.push(row);
        } else if (!hidden) {
          visible.push(row);
        }
      }
      return visible;
    },
  );

  /**
   * Holds the projected data-row cell template, rendered for each data row with the row as its implicit
   * context.
   */
  protected readonly rowTemplate: Signal<TableRowDef | undefined> = contentChild(TableRowDef);

  /**
   * Holds the projected group-header template, rendered for each group row with the row as its implicit
   * context; absent when the consumer projects no group template.
   */
  protected readonly groupTemplate: Signal<TableGroupDef | undefined> = contentChild(TableGroupDef);

  /**
   * Gets the per-column alignment as CSS custom properties (`--table-col-1`, `--table-col-2`, …) set on
   * the table element. The stylesheet reads them to align both the header cell and the consumer's body
   * cells of each column, so a consumer never has to align its projected cells to match the header.
   */
  protected readonly alignStyles: Signal<Record<string, string>> = computed(
    (): Record<string, string> => {
      const styles: Record<string, string> = {};
      this.columns().forEach((column: TableColumn, index: number): void => {
        styles[`--table-col-${index + 1}`] = column.align ?? 'start';
      });
      return styles;
    },
  );

  /**
   * Determines whether a group is currently collapsed.
   * @param id The group row's id.
   * @returns Returns true when the group is collapsed.
   */
  protected isCollapsed(id: string): boolean {
    return this.collapsedGroups().has(id);
  }

  /**
   * Toggles a group row's collapsed state, hiding or revealing its data rows.
   * @param row The group row to toggle.
   */
  protected toggleGroup(row: TableRow): void {
    const next: Set<string> = new Set<string>(this.collapsedGroups());
    if (next.has(row.id)) {
      next.delete(row.id);
    } else {
      next.add(row.id);
    }
    this.collapsedGroups.set(next);
  }

  /**
   * Cycles a sortable column's sort on click: unsorted → ascending → descending → unsorted, resetting
   * to ascending when moving to a different column. Emits the new sort (or null when cleared). A
   * non-sortable column is inert.
   * @param column The clicked column.
   */
  protected toggleSort(column: TableColumn): void {
    if (column.sortable !== true) {
      return;
    }
    const current: TableSort | null = this.currentSort();
    let next: TableSort | null;
    if (current?.columnId !== column.id) {
      next = { columnId: column.id, direction: 'asc' };
    } else if (current.direction === 'asc') {
      next = { columnId: column.id, direction: 'desc' };
    } else {
      next = null;
    }
    this.currentSort.set(next);
    this.sortChange.emit(next);
  }
}
