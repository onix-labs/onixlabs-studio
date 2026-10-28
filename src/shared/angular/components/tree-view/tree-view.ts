import { NgTemplateOutlet } from '@angular/common';
import { CdkVirtualScrollViewport, ScrollingModule } from '@angular/cdk/scrolling';
import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  computed,
  contentChild,
  effect,
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
import type { TreeSelectGesture, TreeSelectMode } from './tree-selection';

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
 * Whether the platform is macOS, where ⌘ adds a row to a selection and selects every row; elsewhere
 * it is Ctrl. On a Mac Ctrl-click is a right click, so it must not toggle.
 */
const MAC: boolean = typeof navigator !== 'undefined' && navigator.userAgent.includes('Mac');

/**
 * Names a semantic colour a row's text and highlight take (#860) — the theme's own tokens, so light,
 * dark and every accent follow. `muted` greys the text and keeps the accent highlight.
 */
export type TreeRowTone = 'danger' | 'success' | 'warning' | 'info' | 'muted';

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
   * Gets the semantic colour the row's text takes, and a muted version of which its hover and
   * selection take in place of the accent; absent for an ordinary row.
   */
  readonly tone?: TreeRowTone;

  /**
   * Gets whether the row's label is emphasised as well as coloured — for a state colour alone would
   * leave ambiguous, such as a conflict among new files.
   */
  readonly strong?: boolean;

  /**
   * Gets a short description of the row's state, shown as its tooltip and read by assistive
   * technology — so a state carried by colour is never carried by colour alone.
   */
  readonly hint?: string;

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
  host: {
    '(click)': 'onHostClick($event)',
  },
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
   * Gets the ids of further rows drawn selected alongside {@link selectedId} — several rows that are
   * each "the current one" of their own group, such as every worktree's checked-out branch. Only
   * {@link selectedId} is scrolled into view.
   */
  public readonly selectedIds: InputSignal<readonly string[]> = input<readonly string[]>([]);

  /**
   * Gets the set of every row drawn selected: {@link selectedId} and {@link selectedIds}.
   */
  protected readonly selection: Signal<ReadonlySet<string>> = computed((): ReadonlySet<string> => {
    const ids: Set<string> = new Set<string>(this.selectedIds());
    const single: string | null = this.selectedId();
    if (single !== null) {
      ids.add(single);
    }
    return ids;
  });

  /**
   * Gets whether several rows can be selected at once (#1048). Off by default, and every tree that
   * leaves it off behaves exactly as before.
   *
   * On, the tree reports selection gestures through {@link rowSelect} — ⌘-click (Ctrl-click off macOS)
   * toggles a row, Shift-click extends from the anchor, ↑/↓ move and Shift+↑/↓ extend, Esc narrows to
   * the row, ⌘A ({@link selectAll}) takes every row, and right-clicking outside the selection selects
   * that row first. A plain click still emits {@link rowClick} too; a modified one does not, since it
   * only selects. The consumer keeps the selection (a {@link import('./tree-selection').TreeSelection})
   * and draws it back through {@link selectedId} and {@link selectedIds}.
   */
  public readonly multiSelect: InputSignal<boolean> = input<boolean>(false);

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
   * Emits the row Enter was pressed on — the keyboard's double click (#1047).
   *
   * Enter still emits {@link rowClick} first, so a tree that treats a click as everything behaves as
   * it always has; a tree where a click only selects listens here too, to open what Enter asks for.
   * Space emits only {@link rowClick}.
   */
  public readonly rowActivate: OutputEmitterRef<TreeRow> = output<TreeRow>();

  /**
   * Emits a selection gesture, when {@link multiSelect} is on (#1048).
   */
  public readonly rowSelect: OutputEmitterRef<TreeSelectGesture> = output<TreeSelectGesture>();

  /**
   * Emits when ⌘A (Ctrl+A off macOS) is pressed on a row, when {@link multiSelect} is on. Never while a
   * row is being named: the field's own ⌘A selects its text.
   */
  public readonly selectAll: OutputEmitterRef<void> = output<void>();

  /**
   * Emits when a click lands on the tree's own area but on no row — the empty space below the last
   * row, or beside a short one — which is how a person says "nothing selected".
   *
   * An event rather than the tree clearing anything itself: the selection is the consumer's, and what
   * it means differs. In an explorer it is only a highlight, and clearing it is what the click asks;
   * in Settings it is the page being shown, and there is no page to show instead.
   */
  public readonly backgroundClick: OutputEmitterRef<void> = output<void>();

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
   *
   * The virtual scroller is also kept measuring its own height: see {@link watchViewportSize}.
   */
  public constructor() {
    this.watchViewportSize();
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
   * Keeps the virtual scroller's idea of its own height current. CDK measures the viewport once,
   * when it is created, and again only when the window resizes — so a tree created while its panel
   * was hidden (a background tab, a worktree checkout, a panel not yet laid out) measured nothing and
   * rendered only its buffer's few rows, filling a third to a half of the panel, until something
   * happened to recreate it; and a splitter drag or a flyout resize was never seen at all. Watching
   * the viewport's own box catches every one of those, and re-measures as it changes.
   */
  private watchViewportSize(): void {
    effect((onCleanup: (cleanup: () => void) => void): void => {
      const viewport: CdkVirtualScrollViewport | undefined = this.viewport();
      if (viewport === undefined) {
        return;
      }
      onCleanup(
        observeSize(viewport.elementRef.nativeElement, (): void => viewport.checkViewportSize()),
      );
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
   * Reports a click on the tree's area that landed on no row. A click inside a row — its label, its
   * icon, a field being typed into, a trailing action — is the row's.
   * @param event The click.
   */
  protected onHostClick(event: MouseEvent): void {
    const target: EventTarget | null = event.target;
    if (target instanceof Element && target.closest('.tree-row') === null) {
      this.backgroundClick.emit();
    }
  }

  /**
   * Activates a row from the keyboard, suppressing the default scroll on Space: both keys click it,
   * and Enter also asks for it to be opened.
   * @param event The keyboard event.
   * @param row The row to activate.
   * @param open Whether the key was Enter, which opens as well as clicks.
   */
  protected activate(event: Event, row: TreeRow, open: boolean = false): void {
    event.preventDefault();
    if (this.multiSelect()) {
      this.rowSelect.emit({ row, mode: 'replace' });
    }
    this.rowClick.emit(row);
    if (open) {
      this.rowActivate.emit(row);
    }
  }

  /**
   * Handles a click on a row. A plain click is a click (and, with {@link multiSelect}, selects the row
   * alone); a ⌘- or Shift-click on a multi-select tree only changes the selection.
   * @param event The click.
   * @param row The row clicked.
   */
  protected onRowClick(event: MouseEvent, row: TreeRow): void {
    if (!this.multiSelect()) {
      this.rowClick.emit(row);
      return;
    }
    const mode: TreeSelectMode = (MAC ? event.metaKey : event.ctrlKey)
      ? 'toggle'
      : event.shiftKey
        ? 'extend'
        : 'replace';
    this.rowSelect.emit({ row, mode });
    if (mode === 'replace') {
      this.rowClick.emit(row);
    } else {
      // A Shift-click would otherwise select the text between the two rows.
      event.preventDefault();
    }
  }

  /**
   * Selects a row right-clicked outside the selection, so the menu and the highlight agree on what it
   * acts on. A row already in the selection keeps the selection: that is how a menu acts on several.
   * @param row The row right-clicked.
   */
  protected onRowContextMenu(row: TreeRow): void {
    if (this.multiSelect() && !this.selection().has(row.id)) {
      this.rowSelect.emit({ row, mode: 'replace' });
    }
  }

  /**
   * Handles the selection keys on a row of a multi-select tree: ↑/↓ move to the next row (Shift
   * extends), Esc narrows to this row, ⌘A selects every row. Keys pressed in a field inside the row —
   * a rename — are the field's.
   * @param event The key press.
   * @param row The row it was pressed on.
   */
  protected onRowKeydown(event: KeyboardEvent, row: TreeRow): void {
    if (!this.multiSelect() || event.target !== event.currentTarget) {
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const rows: readonly TreeRow[] = this.rows();
      const index: number = rows.findIndex(
        (candidate: TreeRow): boolean => candidate.id === row.id,
      );
      const next: TreeRow | undefined = rows[index + (event.key === 'ArrowDown' ? 1 : -1)];
      event.preventDefault();
      if (index >= 0 && next !== undefined) {
        this.rowSelect.emit({ row: next, mode: event.shiftKey ? 'extend' : 'replace' });
        this.focusRow(next.id);
      }
      return;
    }
    if (event.key === 'Escape') {
      this.rowSelect.emit({ row, mode: 'replace' });
      return;
    }
    if (
      event.key.toLowerCase() === 'a' &&
      (MAC ? event.metaKey : event.ctrlKey) &&
      !event.shiftKey &&
      !event.altKey
    ) {
      event.preventDefault();
      this.selectAll.emit();
    }
  }

  /**
   * Moves keyboard focus to a row once it is drawn — on a virtual tree it may first need scrolling
   * into the viewport, which the selection effect does, so a few frames are allowed for it to appear.
   * @param id The row's id.
   * @param attempts How many more frames to wait for it.
   */
  private focusRow(id: string, attempts: number = 4): void {
    const escaped: string = id.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
    const element: HTMLElement | null = this.host.nativeElement.querySelector<HTMLElement>(
      `[data-tree-id="${escaped}"]`,
    );
    if (element !== null) {
      element.focus();
      return;
    }
    if (attempts > 0 && typeof requestAnimationFrame === 'function') {
      requestAnimationFrame((): void => this.focusRow(id, attempts - 1));
    }
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

/**
 * Watches an element's box, calling back whenever its size changes — including from nothing, as an
 * element hidden when it was created comes into view.
 * @param element The element.
 * @param onResize Called with each change.
 * @returns Returns the function that stops watching; a no-op where there is no ResizeObserver (jsdom).
 */
export function observeSize(element: Element, onResize: () => void): () => void {
  if (typeof ResizeObserver === 'undefined') {
    return (): void => undefined;
  }
  const observer: ResizeObserver = new ResizeObserver((): void => onResize());
  observer.observe(element);
  return (): void => observer.disconnect();
}
