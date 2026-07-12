import { NgTemplateOutlet } from '@angular/common';
import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  contentChild,
  ElementRef,
  inject,
  input,
  InputSignal,
  output,
  OutputEmitterRef,
  Signal,
  TemplateRef,
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
 */
@Component({
  selector: 'app-tree-view',
  imports: [AppIcon, NgTemplateOutlet],
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
   * Emits the row that was clicked.
   */
  public readonly rowClick: OutputEmitterRef<TreeRow> = output<TreeRow>();

  /**
   * Holds the projected row-content template, rendered for each row with the row as its implicit
   * context value.
   */
  protected readonly content: Signal<TemplateRef<unknown> | undefined> = contentChild(TemplateRef);

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
      this.rows();
      if (id === null) {
        return;
      }
      // Row ids are arbitrary strings (file paths, composed keys), so match by attribute value
      // rather than baking the id into a selector.
      const row: HTMLElement | undefined = Array.from(
        this.host.nativeElement.querySelectorAll<HTMLElement>('[data-tree-id]'),
      ).find((candidate: HTMLElement): boolean => candidate.getAttribute('data-tree-id') === id);
      // scrollIntoView is missing under jsdom; guard so unit tests of consumers never throw.
      if (row !== undefined && typeof row.scrollIntoView === 'function') {
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
}
