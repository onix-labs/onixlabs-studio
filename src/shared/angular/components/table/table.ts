import { NgTemplateOutlet } from '@angular/common';
import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  computed,
  contentChild,
  Directive,
  effect,
  ElementRef,
  inject,
  input,
  InputSignal,
  output,
  OutputEmitterRef,
  signal,
  Signal,
  TemplateRef,
  viewChild,
  WritableSignal,
} from '@angular/core';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Icon } from '@shared/angular/icons/icon';
import { TooltipTrigger } from '@shared/angular/components/tooltip/tooltip-trigger';

/**
 * The row height a {@link Table.virtual} table assumes before it has measured a rendered row, in
 * pixels: a compact row's height at the default root font size.
 */
const ESTIMATED_ROW_PX: number = 24;

/**
 * How many rows a {@link Table.virtual} table renders when its scroll area has not been measured yet
 * (in tests, or before the first layout): enough to fill a tall window.
 */
const UNMEASURED_VIEWPORT_ROWS: number = 60;

/**
 * How many rows a {@link Table.virtual} table renders beyond each edge of what can be seen, so a
 * fast scroll never shows a blank band before the next window renders.
 */
const OVERSCAN_ROWS: number = 20;

/**
 * The row count a {@link Table.virtual} table's rendered window moves in, so scrolling re-renders once
 * per this many rows rather than on every row boundary.
 */
const WINDOW_STEP_ROWS: number = 10;

/**
 * The slice of a {@link Table.virtual} table's rows that is rendered, and the space standing in for
 * the rows either side of it.
 */
interface RowWindow {
  /**
   * Gets the index of the first rendered row.
   */
  readonly start: number;

  /**
   * Gets the index after the last rendered row.
   */
  readonly end: number;

  /**
   * Gets the height standing in for the rows above the window, in pixels.
   */
  readonly before: number;

  /**
   * Gets the height standing in for the rows below the window, in pixels.
   */
  readonly after: number;
}

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
 * How tall a table's data rows are.
 */
export type TableRowSize = 'compact' | 'comfortable';

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
  imports: [NgTemplateOutlet, AppIcon, TooltipTrigger],
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
   * Gets how tall the data rows are: `compact` for dense lists such as a log, `comfortable` for a
   * manager tool's list, whose rows carry chips, buttons or a second line. Defaults to compact.
   */
  public readonly rowSize: InputSignal<TableRowSize> = input<TableRowSize>('compact');

  /**
   * Gets whether alternate data rows are shaded, so a wide row can be followed across. The pattern
   * restarts under each group header, so every group starts on the same shade. Defaults to false.
   */
  public readonly striped: InputSignal<boolean> = input<boolean>(false);

  /**
   * Gets the ids of the currently-selected rows, highlighted in the table. Selection is driven by the
   * consumer (typically from {@link rowClick}); defaults to none. Purely visual — the table does not
   * manage the set.
   */
  public readonly selectedIds: InputSignal<ReadonlySet<string>> = input<ReadonlySet<string>>(
    new Set<string>(),
  );

  /**
   * Gets whether only the rows near what can be seen are rendered, the rest stood in for by space
   * above and below, so a table of thousands of rows (a log) costs a screenful of rows to render and
   * check. For tables whose rows are all one height — the height is measured from a rendered row —
   * and never collapsed. Off by default: the table renders every row.
   */
  public readonly virtual: InputSignal<boolean> = input<boolean>(false);

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
  private readonly collapsedGroups: WritableSignal<ReadonlySet<string>> = signal<
    ReadonlySet<string>
  >(new Set<string>());

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
   * Gets the ids of the data rows shaded as the alternate stripe: every second row of each group, as it
   * is rendered (a collapsed group's rows are not counted).
   */
  protected readonly alternateIds: Signal<ReadonlySet<string>> = computed(
    (): ReadonlySet<string> => {
      const alternate: Set<string> = new Set<string>();
      if (!this.striped()) {
        return alternate;
      }
      let index: number = 0;
      for (const row of this.visibleRows()) {
        if (row.group === true) {
          index = 0;
          continue;
        }
        if (index % 2 === 1) {
          alternate.add(row.id);
        }
        index += 1;
      }
      return alternate;
    },
  );

  /**
   * Holds the scroll container, which a {@link virtual} table watches to know which rows can be seen.
   */
  private readonly scroller: Signal<ElementRef<HTMLElement> | undefined> =
    viewChild<ElementRef<HTMLElement>>('scroller');

  /**
   * Holds how far the scroll container is scrolled down, in pixels (read by a {@link virtual} table).
   */
  private readonly scrollTop: WritableSignal<number> = signal<number>(0);

  /**
   * Holds the scroll container's visible height, in pixels, or 0 before it has been measured.
   */
  private readonly viewportHeight: WritableSignal<number> = signal<number>(0);

  /**
   * Holds the height of one data row, in pixels: estimated until a rendered row is measured.
   */
  private readonly rowHeight: WritableSignal<number> = signal<number>(ESTIMATED_ROW_PX);

  /**
   * Gets the slice of the rows that is rendered: every row unless {@link virtual}, otherwise the rows
   * that can be seen plus an overscan either side, moved in steps so a scroll re-renders rarely. Equal
   * windows compare equal, so a scroll within a step changes nothing downstream.
   */
  protected readonly rowWindow: Signal<RowWindow> = computed(
    (): RowWindow => {
      const count: number = this.visibleRows().length;
      if (!this.virtual()) {
        return { start: 0, end: count, before: 0, after: 0 };
      }
      const height: number = this.rowHeight();
      const viewport: number = this.viewportHeight();
      const shown: number = viewport > 0 ? Math.ceil(viewport / height) : UNMEASURED_VIEWPORT_ROWS;
      const first: number = Math.floor(this.scrollTop() / height);
      const stepped: number = Math.floor(first / WINDOW_STEP_ROWS) * WINDOW_STEP_ROWS;
      const end: number = Math.min(count, stepped + WINDOW_STEP_ROWS + shown + OVERSCAN_ROWS);
      // Clamped against the end, so a scroll position left over from a longer list still renders the
      // list's last rows rather than nothing.
      const start: number = Math.max(
        0,
        Math.min(stepped - OVERSCAN_ROWS, end - shown - OVERSCAN_ROWS),
      );
      return { start, end, before: start * height, after: (count - end) * height };
    },
    {
      equal: (a: RowWindow, b: RowWindow): boolean =>
        a.start === b.start && a.end === b.end && a.before === b.before && a.after === b.after,
    },
  );

  /**
   * Gets the rows actually rendered: the {@link visibleRows} within the {@link rowWindow}.
   */
  protected readonly renderedRows: Signal<readonly TableRow[]> = computed(
    (): readonly TableRow[] => {
      const rows: readonly TableRow[] = this.visibleRows();
      const { start, end }: RowWindow = this.rowWindow();
      return start === 0 && end === rows.length ? rows : rows.slice(start, end);
    },
  );

  /**
   * Holds the host element, whose rendered rows a {@link virtual} table measures.
   */
  private readonly host: ElementRef<HTMLElement> = inject<ElementRef<HTMLElement>>(ElementRef);

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
   * Wires a {@link virtual} table to its scroll container: follows the scroll position and visible
   * height, and measures a rendered row's height after each render.
   */
  public constructor() {
    // The scroll position and size feed the window. Listened to outside the template so a scroll
    // within a window step costs a signal write and nothing more.
    effect((onCleanup: (cleanup: () => void) => void): void => {
      const element: HTMLElement | undefined = this.scroller()?.nativeElement;
      if (!this.virtual() || element === undefined) {
        return;
      }
      const read: () => void = (): void => {
        this.scrollTop.set(element.scrollTop);
        this.viewportHeight.set(element.clientHeight);
      };
      read();
      element.addEventListener('scroll', read, { passive: true });
      const Observer: typeof ResizeObserver | undefined =
        element.ownerDocument.defaultView?.ResizeObserver;
      const resize: ResizeObserver | null = Observer === undefined ? null : new Observer(read);
      resize?.observe(element);
      onCleanup((): void => {
        element.removeEventListener('scroll', read);
        resize?.disconnect();
      });
    });

    // The row height is measured, not assumed, so a font-size or display-scale change is followed.
    // Read in the render's read phase, after the rows are laid out.
    afterRenderEffect({
      read: (): void => {
        if (!this.virtual() || this.renderedRows().length === 0) {
          return;
        }
        const row: HTMLElement | null = this.host.nativeElement.querySelector('.table-row');
        const height: number = row?.getBoundingClientRect().height ?? 0;
        if (height > 0 && Math.abs(height - this.rowHeight()) > 0.01) {
          this.rowHeight.set(height);
        }
      },
    });
  }

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
