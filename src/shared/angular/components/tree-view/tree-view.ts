import { NgTemplateOutlet } from '@angular/common';
import { CdkVirtualScrollViewport, ScrollingModule } from '@angular/cdk/scrolling';
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
  linkedSignal,
  output,
  OutputEmitterRef,
  Signal,
  TemplateRef,
  viewChild,
  WritableSignal,
} from '@angular/core';
import { CdkContextMenuTrigger } from '@angular/cdk/menu';
import { Icon } from '@shared/angular/icons/icon';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Menu, MenuChoice, MenuItem } from '@shared/angular/components/menu/menu';
import { MenuSubject } from '@shared/angular/components/menu/menu-subject';
import {
  RowEditField,
  RowEditSelection,
} from '@shared/angular/components/row-edit-field/row-edit-field';

/**
 * Specifies the base left padding of a tree row, in pixels.
 */
const BASE_INDENT: number = 8;

/**
 * Specifies the additional left padding added per depth level, in pixels.
 */
const INDENT_STEP: number = 14;

/**
 * Specifies a tree row's height in rem (mirrors `.tree-row`'s block-size in the shared tree styles);
 * the virtual scroller needs it in pixels to size its scrollable extent.
 */
const ROW_HEIGHT_REM: number = 1.75;

/**
 * The fallback root font size, in pixels, when the document's computed size is unavailable (jsdom).
 */
const FALLBACK_ROOT_FONT_PX: number = 16;

/**
 * Whether the DOM is a headless test environment (jsdom), which performs no layout: a virtual
 * scroller there measures a zero-size viewport and renders nothing, so virtualization falls back to
 * the plain list and consumer specs keep exercising real rows.
 */
const HEADLESS_DOM: boolean =
  typeof navigator !== 'undefined' && navigator.userAgent.includes('jsdom');

/**
 * Describes one visible row of a tree: its identity, depth, and expansion state. Consumers carry their
 * own row payload in {@link data} and render it through the projected row-content template.
 */
export interface TreeRow {
  /**
   * Gets the row's stable identity, used for tracking and selection.
   */
  readonly id: string;

  /**
   * Gets the row's depth beneath the root (top-level rows are depth 0).
   */
  readonly depth: number;

  /**
   * Gets a value indicating whether the row can be expanded (shows a chevron).
   */
  readonly expandable: boolean;

  /**
   * Gets a value indicating whether the row is currently expanded.
   */
  readonly expanded: boolean;

  /**
   * Gets a value indicating whether the row reads as disabled — greyed out as a whole, chevron
   * included, because what it stands for is not ready yet.
   *
   * Presentation only: the row still reports its clicks, so a consumer may keep an unready row
   * expandable (expanding one is often how its contents get requested). A consumer that wants it
   * inert as well ignores the click itself.
   */
  readonly disabled?: boolean;

  /**
   * Gets the consumer's payload for the row, read by the projected row-content template.
   */
  readonly data: unknown;
}

/**
 * A row's context-menu selection: the chosen item together with the row it was opened on.
 */
export interface TreeMenuSelection {
  /**
   * Gets the chosen menu item's identifier.
   */
  readonly itemId: string;

  /**
   * Gets the row the menu was opened on.
   */
  readonly row: TreeRow;
}

/**
 * A committed in-place edit: the row that was being named, and the name it was given.
 */
export interface TreeEdit {
  /**
   * Gets the row that was being edited.
   */
  readonly row: TreeRow;

  /**
   * Gets the trimmed name the edit committed, never empty and never the name it started from.
   */
  readonly value: string;
}

/**
 * A reusable tree presenter for hierarchical row surfaces — file trees, solution trees, change
 * lists, and the like. It owns the structural concerns — the flat list of indented rows, the
 * expand/collapse chevron, hover and selection chrome (a full-width fill with an inset accent bar),
 * focus, and accessibility — while each consumer supplies its already-flattened {@link TreeRow}s and
 * projects a row-content template (`<ng-template let-row>`) that renders each row's icon, label, and
 * trailing decorations. Clicking a row emits {@link rowClick}; the consumer decides what that means
 * (toggle a folder, open a file, select a commit).
 *
 * Large-tree consumers (the explorers, whose hosts give the tree a bounded height) opt into
 * {@link virtual} rendering: only the rows in the scrollport get DOM, so an expanded multi-thousand
 * -file solution costs dozens of nodes rather than thousands. Size-to-content consumers (dialogs,
 * sidebars) keep the plain list, which needs no bounded height.
 *
 * A row can also be named in place — renamed, or named for the first time as a placeholder for
 * something about to be created. The consumer names the row in {@link editingId}; the row keeps the
 * consumer's content but gains an inline field after it (the content template is told through its
 * `editing` context value, so it can drop the label and decorations the field replaces), and the tree
 * reports {@link editCommit} or {@link editCancel}. The consumer owns the edit's lifetime: it clears
 * {@link editingId} when either arrives.
 */
@Component({
  selector: 'app-tree-view',
  imports: [
    AppIcon,
    NgTemplateOutlet,
    ScrollingModule,
    CdkContextMenuTrigger,
    Menu,
    MenuSubject,
    RowEditField,
  ],
  templateUrl: './tree-view.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TreeView {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the flattened, visible rows to render in order.
   */
  public readonly rows: InputSignal<readonly TreeRow[]> = input.required<readonly TreeRow[]>();

  /**
   * Gets the id of the selected row, or null when nothing is selected.
   */
  public readonly selectedId: InputSignal<string | null> = input<string | null>(null);

  /**
   * Gets whether rows render through a virtual scroller (only the scrollport's rows get DOM).
   * Requires the host to give the tree a bounded height; size-to-content hosts must leave this off.
   */
  public readonly virtual: InputSignal<boolean> = input<boolean>(false);

  /**
   * Gets whether the virtual scroller is actually used: what the consumer asked for, unless the DOM
   * cannot lay a viewport out (headless tests).
   */
  protected readonly virtualActive: Signal<boolean> = computed(
    (): boolean => this.virtual() && !HEADLESS_DOM,
  );

  /**
   * Emits the row that was clicked.
   */
  public readonly rowClick: OutputEmitterRef<TreeRow> = output<TreeRow>();

  /**
   * Emits the row that was double-clicked.
   *
   * A separate event rather than a count kept here, because the two mean different things and a
   * consumer wants both: the first click still selects, and the second asks for the row to be opened
   * properly. A tree with nothing to open simply does not listen.
   */
  public readonly rowDoubleClick: OutputEmitterRef<TreeRow> = output<TreeRow>();

  /**
   * Gets the factory that builds a row's context-menu items, or null for a tree without one.
   *
   * A function rather than a list, because the items depend on the row: a project offers different
   * commands from a file, and a consumer's capabilities decide which of them are live. It is called
   * when a menu opens, with the row it opened on, so the two can never disagree.
   */
  public readonly contextMenuFor: InputSignal<((row: TreeRow) => readonly MenuItem[]) | null> =
    input<((row: TreeRow) => readonly MenuItem[]) | null>(null);

  /**
   * Emits the chosen context-menu item together with the row it was chosen for.
   */
  public readonly contextMenuSelect: OutputEmitterRef<TreeMenuSelection> =
    output<TreeMenuSelection>();

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
    const row: TreeRow | null = (data ?? null) as TreeRow | null;
    const build: ((row: TreeRow) => readonly MenuItem[]) | null = this.contextMenuFor();
    return row === null || build === null ? [] : build(row);
  };

  /**
   * Gets the id of the row being named in place, or null when no row is.
   */
  public readonly editingId: InputSignal<string | null> = input<string | null>(null);

  /**
   * Gets the name the edited row starts from — its current name for a rename, empty for a placeholder.
   */
  public readonly editValue: InputSignal<string> = input<string>('');

  /**
   * Gets what the edited row's field selects when it opens: the whole name, or a file name's stem.
   */
  public readonly editSelection: InputSignal<RowEditSelection> = input<RowEditSelection>('all');

  /**
   * Emits the edited row with the name it was given, when the edit commits something to apply.
   */
  public readonly editCommit: OutputEmitterRef<TreeEdit> = output<TreeEdit>();

  /**
   * Emits the edited row when the edit is abandoned, or committed with nothing to apply.
   */
  public readonly editCancel: OutputEmitterRef<TreeRow> = output<TreeRow>();

  /**
   * Holds the name being typed into the edited row, reset whenever a new edit begins. Held here rather
   * than in the field, because a virtual scroller rebuilds a row that scrolls out and back, and the
   * draft should survive that.
   */
  protected readonly editDraft: WritableSignal<string> = linkedSignal<string>((): string => {
    this.editingId();
    return this.editValue();
  });

  /**
   * Holds the number of edits begun so far, the source of {@link editSession}'s values.
   */
  private editsBegun: number = 0;

  /**
   * Gets a number that changes whenever a new edit begins, keying the edit field so each edit gets a
   * field of its own rather than one a recycled row carried over from an edit that already ended.
   */
  protected readonly editSession: Signal<number> = computed((): number => {
    this.editingId();
    this.editValue();
    this.editsBegun += 1;
    return this.editsBegun;
  });

  /**
   * Holds the projected row-content template, rendered for each row with the row as its implicit
   * context value.
   */
  protected readonly content: Signal<TemplateRef<unknown> | undefined> = contentChild(TemplateRef);

  /**
   * Holds the virtual scroller's viewport when {@link virtual} rendering is active.
   */
  protected readonly viewport: Signal<CdkVirtualScrollViewport | undefined> =
    viewChild(CdkVirtualScrollViewport);

  /**
   * Gets a row's height in pixels, for the virtual scroller's fixed-size strategy. Derived from the
   * document's root font size, since the row height is authored in rem.
   */
  protected readonly itemSize: number = rowHeightPx();

  /**
   * Holds the component's host element, used to scroll the selected row into view.
   */
  private readonly host: ElementRef<HTMLElement> = inject<ElementRef<HTMLElement>>(ElementRef);

  /**
   * Initializes a new instance of the {@link TreeView} class, keeping the selected row scrolled into
   * view: whenever the selection (or the row set it lives in) changes after render, the selected
   * row is brought into the scrollport — so selection driven from outside (an explorer following the
   * active document) is always visible. A row being edited takes precedence over the selection, since
   * it is where the user is typing.
   */
  public constructor() {
    afterRenderEffect((): void => {
      const id: string | null = this.editingId() ?? this.selectedId();
      const rows: readonly TreeRow[] = this.rows();
      if (id === null) {
        return;
      }
      const viewport: CdkVirtualScrollViewport | undefined = this.viewport();
      if (this.virtualActive() && viewport !== undefined) {
        // The selected row may have no DOM at all; scroll by index instead, reproducing
        // scrollIntoView's `nearest` behaviour (no movement while already visible).
        const index: number = rows.findIndex((row: TreeRow): boolean => row.id === id);
        if (index < 0) {
          return;
        }
        const offset: number = viewport.measureScrollOffset();
        const size: number = viewport.getViewportSize();
        const top: number = index * this.itemSize;
        const bottom: number = top + this.itemSize;
        if (top < offset) {
          viewport.scrollToOffset(top);
        } else if (bottom > offset + size) {
          viewport.scrollToOffset(bottom - size);
        }
        return;
      }
      // Row ids are arbitrary strings (file paths, composed keys); escaping them for a quoted
      // attribute selector lets the row be matched in one query instead of materialising and
      // scanning every rendered row — this runs after every render while a selection exists, so on
      // large trees the scan was O(rows) per frame of tree churn. (Hand-rolled escape: backslashes
      // and quotes are all a quoted CSS string needs, and jsdom lacks CSS.escape.)
      const escaped: string = id.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
      const row: HTMLElement | null = this.host.nativeElement.querySelector<HTMLElement>(
        `[data-tree-id="${escaped}"]`,
      );
      // scrollIntoView is missing under jsdom; guard so unit tests of consumers never throw.
      if (row !== null && typeof row.scrollIntoView === 'function') {
        row.scrollIntoView({ block: 'nearest' });
      }
    });
  }

  /**
   * Computes the left padding for a row at the given depth.
   * @param depth The row's depth beneath the root.
   * @returns Returns the left padding in pixels.
   */
  protected indentFor(depth: number): number {
    return BASE_INDENT + depth * INDENT_STEP;
  }

  /**
   * Activates a row from the keyboard (Enter or Space), suppressing the default scroll on Space.
   * @param event The keyboard event.
   * @param row The row to activate.
   */
  protected activate(event: Event, row: TreeRow): void {
    event.preventDefault();
    this.rowClick.emit(row);
  }

  /**
   * Gets whether a row is the one being named in place.
   * @param row The row to test.
   * @returns Returns true when the row is being edited; otherwise, false.
   */
  protected isEditing(row: TreeRow): boolean {
    return row.id === this.editingId();
  }

  /**
   * Reports a committed edit with the row it was made on.
   * @param row The row that was edited.
   * @param value The trimmed name it was given.
   */
  protected onEditCommit(row: TreeRow, value: string): void {
    this.editCommit.emit({ row, value });
  }

  /**
   * Tracks a virtual row by its stable identity.
   * @param _index The row's index.
   * @param row The row.
   * @returns Returns the row's id.
   */
  protected trackRow(_index: number, row: TreeRow): string {
    return row.id;
  }

  /**
   * Gets whether a row has any context-menu items, which is what decides whether right-clicking it
   * opens anything.
   *
   * A tree usually has rows its commands cannot act on — a grouping that stands for nothing on disk,
   * a placeholder — and opening an empty panel on those reads as a bug rather than as an answer. The
   * factory is asked per row rather than cached because a row's items depend on state that moves
   * under it; the cost is one small array per rendered row, and only the rows in the scrollport
   * render.
   * @param row The row to test.
   * @returns Returns true when the row has at least one item; otherwise, false.
   */
  protected rowHasMenu(row: TreeRow): boolean {
    // A row being named offers no menu: its commands would act on the entry as it was before the name
    // being typed, or — for a placeholder — on nothing at all.
    return !this.isEditing(row) && this.menuItemsFor(row).length > 0;
  }

  /**
   * Re-emits a context-menu choice with the row it was made on.
   * @param choice The chosen item and the data its menu opened with.
   */
  protected onContextChoice(choice: MenuChoice): void {
    const row: TreeRow | null = (choice.data ?? null) as TreeRow | null;
    if (row !== null) {
      this.contextMenuSelect.emit({ itemId: choice.id, row });
    }
  }
}

/**
 * Resolves a tree row's height in pixels from the document's root font size.
 * @returns Returns the row height in pixels.
 */
function rowHeightPx(): number {
  const parsed: number = Number.parseFloat(
    getComputedStyle(document.documentElement).fontSize || '',
  );
  const rootPx: number = Number.isFinite(parsed) && parsed > 0 ? parsed : FALLBACK_ROOT_FONT_PX;
  return Math.round(rootPx * ROW_HEIGHT_REM);
}
