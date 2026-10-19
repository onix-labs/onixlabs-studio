import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  input,
  InputSignal,
  output,
  OutputEmitterRef,
  signal,
  Signal,
  viewChild,
  WritableSignal,
} from '@angular/core';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { MarkdownRenderer } from '@shared/angular/components/markdown-renderer/markdown-renderer';
import type {
  CompletionDetails,
  CompletionRow,
} from '@shared/angular/services/autocomplete/completion-rows';
import { Shell } from '@shared/angular/services/shell/shell';

/**
 * Holds how many rows the list shows at most before it scrolls.
 */
export const VISIBLE_ROWS: number = 12;

/**
 * Holds the row height the list assumes before it has measured a rendered row, in pixels.
 */
const ESTIMATED_ROW_PX: number = 22;

/**
 * Holds how many rows are rendered beyond each edge of what can be seen, so a quick scroll never shows
 * a blank band.
 */
const OVERSCAN_ROWS: number = 8;

/**
 * Holds the schemes a link in the details pane opens, in the operating system's browser.
 */
const EXTERNAL_LINK: RegExp = /^(?:https?|mailto):/i;

/**
 * Names where the details pane is: beside the list, or under it when there is no room beside.
 */
export type CompletionPlacement = 'side' | 'below';

/**
 * What Studio's completion list shows (#1021).
 */
export interface CompletionListView {
  /**
   * Gets how many rows there are.
   */
  readonly count: number;

  /**
   * Builds a row, for the rows that are rendered.
   */
  readonly row: (index: number) => CompletionRow;

  /**
   * Gets the index of the focused row, or -1 for none.
   */
  readonly focused: number;

  /**
   * Gets what the list says when it has no rows ("Loading…", "No suggestions."), or null.
   */
  readonly message: string | null;

  /**
   * Gets what the details pane shows of the focused row, or null to show no pane.
   */
  readonly details: CompletionDetails | null;

  /**
   * Gets where the details pane is.
   */
  readonly placement: CompletionPlacement;

  /**
   * Gets the prefix of the rows' element identifiers, unique to the editor, which the editor's text
   * area names as its active descendant.
   */
  readonly idPrefix: string;
}

/**
 * A rendered row and its index.
 */
interface RenderedRow {
  /**
   * Gets the row's index in the list.
   */
  readonly index: number;

  /**
   * Gets the row.
   */
  readonly row: CompletionRow;
}

/**
 * Draws Studio's completion list (#1021), in place of Monaco's suggest widget: each completion's kind
 * icon, its label with what was typed highlighted, and its detail, with the focused row's
 * documentation in a details pane beside the list (or under it, when there is no room beside).
 *
 * The editor keeps the keyboard — typing, an input method, the list's keys — so the list never takes
 * focus: a press on it is kept from moving focus, and a click on a row only says which row was chosen.
 * The list is a `listbox` whose focused option is its active descendant (and the editor's text area's).
 * Only the rows that can be seen are rendered, so a list of thousands costs no more than a dozen.
 */
@Component({
  selector: 'app-completion-list',
  imports: [AppIcon, MarkdownRenderer],
  templateUrl: './completion-list.html',
  styleUrl: './completion-list.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.completion-list--below]': "view().placement === 'below'",
    '(mousedown)': '$event.preventDefault()',
    '(click)': 'onClick($event)',
  },
})
export class CompletionList {
  /**
   * Gets what the list shows.
   */
  public readonly view: InputSignal<CompletionListView> = input.required<CompletionListView>();

  /**
   * Raised with a row's index when the row is clicked.
   */
  public readonly chosen: OutputEmitterRef<number> = output<number>();

  /**
   * Holds the shell a link in the details opens through.
   */
  private readonly shell: Shell = inject(Shell);

  /**
   * Holds the host element, whose rendered rows are measured.
   */
  private readonly host: ElementRef<HTMLElement> = inject<ElementRef<HTMLElement>>(ElementRef);

  /**
   * Holds the scrolling list.
   */
  private readonly scroller: Signal<ElementRef<HTMLElement> | undefined> =
    viewChild<ElementRef<HTMLElement>>('scroller');

  /**
   * Holds how far the list is scrolled, in pixels.
   */
  private readonly scrollTop: WritableSignal<number> = signal<number>(0);

  /**
   * Holds the height of one row, in pixels: estimated until a rendered row is measured.
   */
  private readonly rowHeight: WritableSignal<number> = signal<number>(ESTIMATED_ROW_PX);

  /**
   * Holds the focused row and row count last revealed, so the focused row is scrolled into view when
   * either changes — not when the user has scrolled the list themselves.
   */
  private revealed: string = '';

  /**
   * Gets the list's height, in pixels: as many rows as there are, up to {@link VISIBLE_ROWS}.
   */
  protected readonly listHeight: Signal<number> = computed(
    (): number => Math.min(this.view().count, VISIBLE_ROWS) * this.rowHeight(),
  );

  /**
   * Gets the identifier of the focused row's element, or null when no row is focused.
   */
  protected readonly activeId: Signal<string | null> = computed((): string | null => {
    const view: CompletionListView = this.view();
    return view.focused < 0 ? null : this.optionId(view.focused);
  });

  /**
   * Gets the window of rows rendered: those that can be seen, and an overscan either side.
   */
  private readonly window: Signal<{ readonly start: number; readonly end: number }> = computed(
    (): { readonly start: number; readonly end: number } => {
      const count: number = this.view().count;
      const first: number = Math.floor(this.scrollTop() / this.rowHeight());
      const start: number = Math.max(0, Math.min(first, count - VISIBLE_ROWS) - OVERSCAN_ROWS);
      return { start, end: Math.min(count, first + VISIBLE_ROWS + OVERSCAN_ROWS) };
    },
    {
      equal: (
        a: { readonly start: number; readonly end: number },
        b: { readonly start: number; readonly end: number },
      ): boolean => a.start === b.start && a.end === b.end,
    },
  );

  /**
   * Gets the rows rendered.
   */
  protected readonly rendered: Signal<readonly RenderedRow[]> = computed(
    (): readonly RenderedRow[] => {
      const view: CompletionListView = this.view();
      const { start, end }: { readonly start: number; readonly end: number } = this.window();
      const rows: RenderedRow[] = [];
      for (let index: number = start; index < end; index += 1) {
        rows.push({ index, row: view.row(index) });
      }
      return rows;
    },
  );

  /**
   * Gets the height standing in for the rows above the rendered ones, in pixels.
   */
  protected readonly before: Signal<number> = computed(
    (): number => this.window().start * this.rowHeight(),
  );

  /**
   * Gets the height standing in for the rows below the rendered ones, in pixels.
   */
  protected readonly after: Signal<number> = computed(
    (): number => (this.view().count - this.window().end) * this.rowHeight(),
  );

  /**
   * Initializes a new instance of the {@link CompletionList} class: measures a row once rendered, and
   * keeps the focused row in view.
   */
  public constructor() {
    afterRenderEffect({
      read: (): void => {
        this.rendered();
        const row: HTMLElement | null =
          this.host.nativeElement.querySelector('.completion-list__row');
        const height: number = row?.getBoundingClientRect().height ?? 0;
        if (height > 0 && Math.abs(height - this.rowHeight()) > 0.01) {
          this.rowHeight.set(height);
        }
      },
    });
    afterRenderEffect({
      write: (): void => {
        const view: CompletionListView = this.view();
        const height: number = this.rowHeight();
        const element: HTMLElement | undefined = this.scroller()?.nativeElement;
        const key: string = `${view.focused}:${view.count}`;
        if (element === undefined || key === this.revealed) {
          return;
        }
        this.revealed = key;
        const top: number = revealTop(view.focused, height, element.scrollTop, this.listHeight());
        if (top !== element.scrollTop) {
          element.scrollTop = top;
          this.scrollTop.set(top);
        }
      },
    });
  }

  /**
   * Builds the element identifier of a row.
   * @param index The row's index.
   * @returns Returns the identifier.
   */
  protected optionId(index: number): string {
    return `${this.view().idPrefix}-${index}`;
  }

  /**
   * Follows the list's scroll position, which decides the rows rendered.
   * @param event The scroll.
   */
  protected onScroll(event: Event): void {
    this.scrollTop.set((event.target as HTMLElement).scrollTop);
  }

  /**
   * Answers a click: on a row, says the row was chosen (the keyboard stays with the editor, which
   * accepts with Enter and Tab); on a link in the details, keeps it from navigating the window — a web
   * or mail link opens in the operating system's browser, and any other link opens nothing.
   * @param event The click.
   */
  protected onClick(event: MouseEvent): void {
    const target: Element | null = event.target instanceof Element ? event.target : null;
    const row: HTMLElement | null =
      target?.closest<HTMLElement>('.completion-list__row[data-index]') ?? null;
    if (row !== null) {
      this.chosen.emit(Number(row.dataset['index']));
      return;
    }
    const anchor: HTMLAnchorElement | null = target?.closest('a') ?? null;
    if (anchor === null) {
      return;
    }
    event.preventDefault();
    const href: string = anchor.getAttribute('href') ?? '';
    if (EXTERNAL_LINK.test(href)) {
      void this.shell.openExternal(href);
    }
  }
}

/**
 * Works out how far to scroll a list so a row is in view, moving it as little as possible.
 * @param index The row's index, or -1 for none.
 * @param rowHeight The height of a row, in pixels.
 * @param scrollTop How far the list is scrolled now.
 * @param viewport The list's visible height.
 * @returns Returns how far to scroll.
 */
export function revealTop(
  index: number,
  rowHeight: number,
  scrollTop: number,
  viewport: number,
): number {
  if (index < 0) {
    return scrollTop;
  }
  const top: number = index * rowHeight;
  if (top < scrollTop) {
    return top;
  }
  return top + rowHeight > scrollTop + viewport ? top + rowHeight - viewport : scrollTop;
}
