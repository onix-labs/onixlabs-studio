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
  output,
  OutputEmitterRef,
  Signal,
  TemplateRef,
  viewChild,
} from '@angular/core';
import { Icon } from '@shared/angular/icons/icon';
import { AppIcon } from '@shared/angular/components/icon/app-icon';

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
   * Gets the consumer's payload for the row, read by the projected row-content template.
   */
  readonly data: unknown;
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
 */
@Component({
  selector: 'app-tree-view',
  imports: [AppIcon, NgTemplateOutlet, ScrollingModule],
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
   * Holds the projected row-content template, rendered for each row with the row as its implicit
   * context value.
   */
  protected readonly content: Signal<TemplateRef<unknown> | undefined> = contentChild(TemplateRef);

  /**
   * Holds the virtual scroller's viewport when {@link virtual} rendering is active.
   */
  protected readonly viewport: Signal<CdkVirtualScrollViewport | undefined> = viewChild(
    CdkVirtualScrollViewport,
  );

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
   * active document) is always visible.
   */
  public constructor() {
    afterRenderEffect((): void => {
      const id: string | null = this.selectedId();
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
   * Tracks a virtual row by its stable identity.
   * @param _index The row's index.
   * @param row The row.
   * @returns Returns the row's id.
   */
  protected trackRow(_index: number, row: TreeRow): string {
    return row.id;
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
