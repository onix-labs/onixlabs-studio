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
  imports: [NgTemplateOutlet],
  templateUrl: './list-view.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ListView {
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
   * Emits the row that was clicked or keyboard-activated.
   */
  public readonly rowClick: OutputEmitterRef<ListRow> = output<ListRow>();

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
}
