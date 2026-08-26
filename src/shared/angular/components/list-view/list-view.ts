import {
  CdkDrag,
  CdkDragHandle,
  CdkDragSortEvent,
  CdkDropList,
  moveItemInArray,
} from '@angular/cdk/drag-drop';
import { NgTemplateOutlet } from '@angular/common';
import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  computed,
  contentChild,
  ElementRef,
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
import { CdkContextMenuTrigger } from '@angular/cdk/menu';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Icon } from '@shared/angular/icons/icon';
import { Menu, MenuChoice, MenuItem } from '@shared/angular/components/menu/menu';

/**
 * Describes one row of a list: its identity and the consumer's payload, rendered through the
 * projected row-content template.
 */
export interface ListRow {
  /**
   * Gets the row's stable identity, used for tracking and selection.
   */
  readonly id: string;

  /**
   * Gets the consumer's payload for the row, read by the projected row-content template.
   */
  readonly data: unknown;
}

/**
 * Describes a drag-reorder: the row being moved and the row whose position it should take, both by id
 * so the consumer never has to reconcile indices against its own ordering.
 */
export interface ListReorder {
  /**
   * Gets the id of the row being moved.
   */
  readonly from: string;

  /**
   * Gets the id of the row whose position the moved row should take.
   */
  readonly to: string;
}

/**
 * A row's context-menu selection: the chosen item together with the row it was opened on.
 */
export interface ListMenuSelection {
  /**
   * Gets the chosen menu item's identifier.
   */
  readonly itemId: string;

  /**
   * Gets the row the menu was opened on.
   */
  readonly row: ListRow;
}

/**
 * A reusable flat-list presenter, the tree view's sibling for non-hierarchical row surfaces —
 * history lists, result lists, and the like. It owns the structural concerns — the scrolling row
 * list, hover and selection chrome (the same accent-tinted fill the tree uses), focus, keyboard
 * activation, and an optional empty state — while each consumer supplies its {@link ListRow}s and
 * projects a row-content template (`<ng-template let-row>`) that renders each row's content.
 * Clicking a row (or pressing Enter/Space on it) emits {@link rowClick}; the consumer decides what
 * that means. The selected row is kept scrolled into view.
 */
@Component({
  selector: 'app-list-view',
  imports: [
    NgTemplateOutlet,
    CdkDropList,
    CdkDrag,
    CdkDragHandle,
    AppIcon,
    CdkContextMenuTrigger,
    Menu,
  ],
  templateUrl: './list-view.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ListView {
  /**
   * Gets the grip glyph shown on each row's reorder handle. Defaults to the standard vertical grip; a
   * consumer whose rows want a heavier handle can state another (for example the bold grip).
   */
  public readonly gripIcon: InputSignal<Icon> = input<Icon>(Icon.GRIP_VERTICAL);

  /**
   * Gets the rows to render in order.
   */
  public readonly rows: InputSignal<readonly ListRow[]> = input.required<readonly ListRow[]>();

  /**
   * Gets the id of the selected row, or null when nothing is selected.
   */
  public readonly selectedId: InputSignal<string | null> = input<string | null>(null);

  /**
   * Gets the text shown when the list has no rows, or an empty string to show nothing.
   */
  public readonly emptyText: InputSignal<string> = input<string>('');

  /**
   * Gets whether rows can be dragged to reorder them. When on, each row grows a trailing grip handle
   * that starts the drag, and a settled drag emits {@link reorder}; the consumer owns the order, so it
   * must apply the move for the list to change.
   */
  public readonly reorderable: InputSignal<boolean> = input<boolean>(false);

  /**
   * Emits the row that was clicked or keyboard-activated.
   */
  public readonly rowClick: OutputEmitterRef<ListRow> = output<ListRow>();

  /**
   * Emits a drag-reorder, identifying the moved row and the row whose position it should take.
   */
  public readonly reorder: OutputEmitterRef<ListReorder> = output<ListReorder>();

  /**
   * Gets the factory that builds a row's context-menu items, or null for a list without one.
   *
   * A function rather than a list, because the items depend on the row: a checkout offers different
   * commands from a placeholder that stands for nothing yet, and a consumer's capabilities decide
   * which of them are live. It is called when a menu opens, with the row it opened on, so the two can
   * never disagree. The same contract the tree view offers, so a consumer that moves between the two
   * presenters keeps its factory.
   */
  public readonly contextMenuFor: InputSignal<((row: ListRow) => readonly MenuItem[]) | null> =
    input<((row: ListRow) => readonly MenuItem[]) | null>(null);

  /**
   * Emits the chosen context-menu item together with the row it was chosen for.
   */
  public readonly contextMenuSelect: OutputEmitterRef<ListMenuSelection> =
    output<ListMenuSelection>();

  /**
   * Gets whether a context menu is offered, which is what puts the trigger on each row.
   */
  protected readonly hasContextMenu: Signal<boolean> = computed(
    (): boolean => this.contextMenuFor() !== null,
  );

  /**
   * Builds the context-menu items for the row a menu opened on.
   *
   * Bound as a value rather than called from the template, because it is handed to the menu as its
   * item factory: `this` must stay this component when the menu invokes it.
   */
  protected readonly menuItemsFor: (data: unknown) => readonly MenuItem[] = (
    data: unknown,
  ): readonly MenuItem[] => {
    const row: ListRow | null = (data ?? null) as ListRow | null;
    const build: ((row: ListRow) => readonly MenuItem[]) | null = this.contextMenuFor();
    return row === null || build === null ? [] : build(row);
  };

  /**
   * Holds the projected row-content template, rendered for each row with the row as its implicit
   * context value.
   */
  protected readonly content: Signal<TemplateRef<unknown> | undefined> = contentChild(TemplateRef);

  /**
   * Holds a value indicating whether a reorder drag is in progress.
   */
  private readonly dragging: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds the rows captured at drag start, rendered for the duration of the drag in place of the live
   * {@link rows}. Reorder is emitted live (as the drag sorts), so the consumer's order — and any view
   * driven off it — changes mid-drag; rendering the frozen snapshot keeps this list's own DOM stable
   * so Angular does not re-order the very elements the drag toolkit is moving underneath it.
   */
  private readonly frozenRows: WritableSignal<readonly ListRow[]> = signal<readonly ListRow[]>([]);

  /**
   * Gets the rows to render: the live rows normally, or the drag-start snapshot while a drag is in
   * progress.
   */
  protected readonly displayRows: Signal<readonly ListRow[]> = computed((): readonly ListRow[] =>
    this.dragging() ? this.frozenRows() : this.rows(),
  );

  /**
   * Holds the ids in their current drag order, mirroring the drag toolkit's own item shuffling so each
   * sort step can be translated back to a moved/target id pair against a stable basis (the live
   * {@link rows} are changing underneath the drag as reorder is applied).
   */
  private liveOrder: string[] = [];

  /**
   * Holds the component's host element, used to scroll the selected row into view.
   */
  private readonly host: ElementRef<HTMLElement> = inject<ElementRef<HTMLElement>>(ElementRef);

  /**
   * Initializes a new instance of the {@link ListView} class, keeping the selected row scrolled into
   * view whenever the selection (or the row set it lives in) changes after render.
   */
  public constructor() {
    afterRenderEffect((): void => {
      const id: string | null = this.selectedId();
      this.rows();
      if (id === null) {
        return;
      }
      // Row ids are arbitrary strings, so match by attribute value rather than baking the id into a
      // selector.
      const row: HTMLElement | undefined = Array.from(
        this.host.nativeElement.querySelectorAll<HTMLElement>('[data-list-id]'),
      ).find((candidate: HTMLElement): boolean => candidate.getAttribute('data-list-id') === id);
      // scrollIntoView is missing under jsdom; guard so unit tests of consumers never throw.
      if (row !== undefined && typeof row.scrollIntoView === 'function') {
        row.scrollIntoView({ block: 'nearest' });
      }
    });
  }

  /**
   * Activates a row from the keyboard (Enter or Space), suppressing the default scroll on Space.
   * @param event The keyboard event.
   * @param row The row to activate.
   */
  protected activate(event: Event, row: ListRow): void {
    event.preventDefault();
    this.rowClick.emit(row);
  }

  /**
   * Gets whether a row has any context-menu items, which is what decides whether right-clicking it
   * opens anything.
   *
   * A list usually has rows its commands cannot act on — a reserved placeholder, a heading — and
   * opening an empty panel on those reads as a bug rather than as an answer. The factory is asked per
   * row rather than cached because a row's items depend on state that moves under it (a checkout that
   * is mid-removal offers less than an idle one); the cost is one small array per rendered row.
   * @param row The row to test.
   * @returns Returns true when the row has at least one item; otherwise, false.
   */
  protected rowHasMenu(row: ListRow): boolean {
    return this.menuItemsFor(row).length > 0;
  }

  /**
   * Re-emits a context-menu choice with the row it was made on.
   * @param choice The chosen item and the data its menu opened with.
   */
  protected onContextChoice(choice: MenuChoice): void {
    const row: ListRow | null = (choice.data ?? null) as ListRow | null;
    if (row !== null) {
      this.contextMenuSelect.emit({ itemId: choice.id, row });
    }
  }

  /**
   * Captures the row order at drag start, so the list can render a stable snapshot while the live order
   * reorders beneath it and the sort steps have a fixed index basis to translate against.
   */
  protected onDragStarted(): void {
    const rows: readonly ListRow[] = this.rows();
    this.frozenRows.set(rows);
    this.liveOrder = rows.map((row: ListRow): string => row.id);
    this.dragging.set(true);
  }

  /**
   * Emits a {@link reorder} for each sort step of an in-progress drag, so the consumer's order (and any
   * view driven off it, such as the Mission Control columns) reorders live rather than only on drop.
   * Each step's indices are read against {@link liveOrder} — the toolkit's own running order — then that
   * mirror is advanced in step, so the moved/target ids stay correct across successive swaps.
   * @param event The sort event describing the step.
   */
  protected onSorted(event: CdkDragSortEvent<readonly ListRow[]>): void {
    const from: string | undefined = this.liveOrder[event.previousIndex];
    const to: string | undefined = this.liveOrder[event.currentIndex];
    if (from !== undefined && to !== undefined && from !== to) {
      this.reorder.emit({ from, to });
    }
    moveItemInArray(this.liveOrder, event.previousIndex, event.currentIndex);
  }

  /**
   * Ends the drag, dropping the frozen snapshot so the list returns to rendering the live rows — which,
   * having been reordered live through {@link onSorted}, already hold the settled order. The drop event
   * is unread and nothing is emitted here: the move was applied step by step during the drag.
   */
  protected onDrop(): void {
    this.dragging.set(false);
  }
}
