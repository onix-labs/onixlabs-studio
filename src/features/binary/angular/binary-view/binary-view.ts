import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  input,
  InputSignal,
  OnDestroy,
  Signal,
  signal,
  viewChild,
  WritableSignal,
} from '@angular/core';
import { BinaryDocumentEntry, BinarySelection } from '../binary-document/binary-document';
import { BinaryDocuments } from '../binary-document/binary-document';
import { BinaryStatus } from '../binary-status/binary-status';

/**
 * Holds the fixed height, in pixels, of one byte-row. Fixed so the total scroll height is the row
 * count times this, and the visible window maps directly to a scroll offset.
 */
const ROW_HEIGHT: number = 20;

/**
 * Holds how many extra rows are rendered above and below the viewport, so scrolling does not reveal
 * blank rows before the next frame renders.
 */
const OVERSCAN: number = 8;

/**
 * Describes a single rendered byte cell.
 */
interface BinaryCell {
  /**
   * Gets the absolute byte offset the cell represents.
   */
  readonly offset: number;

  /**
   * Gets the two-character hex representation, or a placeholder when the byte has not loaded.
   */
  readonly hex: string;

  /**
   * Gets the printable-ASCII representation, or `·` for a non-printable or unloaded byte.
   */
  readonly ascii: string;

  /**
   * Gets a value indicating whether the cell falls within the current selection.
   */
  readonly selected: boolean;
}

/**
 * Describes a single rendered row: its address and its byte cells.
 */
interface BinaryRow {
  /**
   * Gets the zero-based row index, used as the render track key.
   */
  readonly index: number;

  /**
   * Gets the row's address (the offset of its first byte) as fixed-width hex.
   */
  readonly address: string;

  /**
   * Gets the row's byte cells (fewer than a full row on the final row).
   */
  readonly cells: readonly BinaryCell[];
}

/**
 * Represents the binary editor's tab view: a fixed-width Address · Hex · ASCII grid over a file's
 * bytes, virtualised by hand so only the visible rows exist in the DOM and only the visible byte
 * window is read from disk. Selecting bytes in either the hex or ASCII column highlights the same
 * bytes in both. Read-only for this phase.
 */
@Component({
  selector: 'app-binary-view',
  imports: [],
  templateUrl: './binary-view.html',
  styleUrl: './binary-view.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(window:pointerup)': 'onPointerUp()',
  },
})
export class BinaryView implements OnDestroy {
  /**
   * Holds the binary document registry the view resolves its document from.
   */
  private readonly binaryDocuments: BinaryDocuments = inject(BinaryDocuments);

  /**
   * Holds the status service the active view publishes its cursor/selection/size to.
   */
  private readonly binaryStatus: BinaryStatus = inject(BinaryStatus);

  /**
   * Holds the scroll container, measured for the viewport height and driven for go-to-offset reveals.
   */
  private readonly scroller: Signal<ElementRef<HTMLElement> | undefined> =
    viewChild<ElementRef<HTMLElement>>('scroller');

  /**
   * Holds the current scroll offset of the grid, in pixels.
   */
  private readonly scrollTop: WritableSignal<number> = signal<number>(0);

  /**
   * Holds the measured height of the scroll viewport, in pixels.
   */
  private readonly viewportHeight: WritableSignal<number> = signal<number>(0);

  /**
   * Holds whether a pointer selection drag is in progress.
   */
  private selecting: boolean = false;

  /**
   * Holds the byte offset a selection drag started from.
   */
  private anchor: number = 0;

  /**
   * Gets the identifier of the tab this view represents.
   */
  public readonly tabId: InputSignal<string> = input.required<string>();

  /**
   * Gets a value indicating whether this view belongs to the active tab.
   */
  public readonly isActive: InputSignal<boolean> = input<boolean>(false);

  /**
   * Gets the fixed row height, exposed for the template's inline sizing.
   */
  protected readonly rowHeight: number = ROW_HEIGHT;

  /**
   * Holds the resolved binary document, or undefined when the tab has none.
   */
  protected readonly document: Signal<BinaryDocumentEntry | undefined> = computed(
    (): BinaryDocumentEntry | undefined => this.binaryDocuments.get(this.tabId()),
  );

  /**
   * Holds the number of bytes rendered per row.
   */
  protected readonly bytesPerRow: Signal<number> = computed(
    (): number => this.document()?.bytesPerRow() ?? 16,
  );

  /**
   * Holds the column header labels (byte index within a row, as hex).
   */
  protected readonly columnLabels: Signal<readonly string[] > = computed((): readonly string[] =>
    Array.from({ length: this.bytesPerRow() }, (_unused: unknown, index: number): string =>
      index.toString(16).padStart(2, '0').toUpperCase(),
    ),
  );

  /**
   * Holds the total number of rows in the file.
   */
  protected readonly rowCount: Signal<number> = computed((): number => {
    const size: number = this.document()?.size() ?? 0;
    return Math.ceil(size / this.bytesPerRow());
  });

  /**
   * Holds the total scrollable height, in pixels.
   */
  protected readonly totalHeight: Signal<number> = computed(
    (): number => this.rowCount() * ROW_HEIGHT,
  );

  /**
   * Holds the index of the first rendered row (including overscan).
   */
  private readonly firstRow: Signal<number> = computed((): number =>
    Math.max(0, Math.floor(this.scrollTop() / ROW_HEIGHT) - OVERSCAN),
  );

  /**
   * Holds the index one past the last rendered row.
   */
  private readonly lastRow: Signal<number> = computed((): number => {
    const visible: number = Math.ceil(this.viewportHeight() / ROW_HEIGHT) + OVERSCAN * 2;
    return Math.min(this.rowCount(), this.firstRow() + visible);
  });

  /**
   * Holds the pixel offset the rendered window is translated by, keeping rows at their true position.
   */
  protected readonly offsetY: Signal<number> = computed((): number => this.firstRow() * ROW_HEIGHT);

  /**
   * Holds the rows currently rendered, built from the loaded byte window and current selection.
   */
  protected readonly rows: Signal<readonly BinaryRow[]> = computed((): readonly BinaryRow[] => {
    const document: BinaryDocumentEntry | undefined = this.document();
    if (document === undefined) {
      return [];
    }
    // Re-run whenever a byte block arrives so newly-loaded bytes replace their placeholders.
    document.loadedVersion();
    const bytesPerRow: number = document.bytesPerRow();
    const size: number = document.size();
    const selection: BinarySelection | null = document.selection();
    const first: number = this.firstRow();
    const last: number = this.lastRow();
    const rows: BinaryRow[] = [];
    for (let row: number = first; row < last; row += 1) {
      const base: number = row * bytesPerRow;
      const cells: BinaryCell[] = [];
      for (let column: number = 0; column < bytesPerRow; column += 1) {
        const offset: number = base + column;
        if (offset >= size) {
          break;
        }
        const value: number | null = document.byteAt(offset);
        const selected: boolean =
          selection !== null && offset >= selection.start && offset < selection.end;
        cells.push({
          offset,
          hex: value === null ? '··' : value.toString(16).padStart(2, '0').toUpperCase(),
          ascii: value === null ? '·' : this.printable(value),
          selected,
        });
      }
      rows.push({ index: row, address: base.toString(16).padStart(8, '0').toUpperCase(), cells });
    }
    return rows;
  });

  /**
   * Initializes the view: measures the viewport, keeps the visible byte window loaded, publishes
   * status while active, and honours go-to-offset reveals from the ribbon.
   */
  public constructor() {
    afterNextRender((): void => {
      const element: HTMLElement | undefined = this.scroller()?.nativeElement;
      if (element === undefined) {
        return;
      }
      this.viewportHeight.set(element.clientHeight);
      const observer: ResizeObserver = new ResizeObserver((): void => {
        this.viewportHeight.set(element.clientHeight);
      });
      observer.observe(element);
    });

    // Keep the blocks spanning the visible rows loaded as the viewport moves.
    effect((): void => {
      const document: BinaryDocumentEntry | undefined = this.document();
      if (document === undefined) {
        return;
      }
      const first: number = this.firstRow();
      const last: number = this.lastRow();
      if (last > first) {
        const bytesPerRow: number = document.bytesPerRow();
        document.ensureRange(first * bytesPerRow, (last - first) * bytesPerRow);
      }
    });

    // Publish this view's context to the status strip while it is the active tab.
    effect((): void => {
      const document: BinaryDocumentEntry | undefined = this.document();
      if (this.isActive() && document !== undefined) {
        const selection: BinarySelection | null = document.selection();
        this.binaryStatus.publish(this.tabId(), {
          path: document.path,
          offset: document.cursor(),
          selectionLength: selection === null ? 0 : selection.end - selection.start,
          size: document.size(),
        });
      } else {
        this.binaryStatus.clear(this.tabId());
      }
    });

    // Scroll to bring a ribbon "go to offset" target into view.
    effect((): void => {
      const document: BinaryDocumentEntry | undefined = this.document();
      if (document === undefined) {
        return;
      }
      document.revealVersion();
      const target: number | null = document.revealOffset;
      const element: HTMLElement | undefined = this.scroller()?.nativeElement;
      if (target === null || element === undefined) {
        return;
      }
      const targetRow: number = Math.floor(target / document.bytesPerRow());
      const centred: number = targetRow * ROW_HEIGHT - element.clientHeight / 2;
      element.scrollTop = Math.max(0, centred);
    });
  }

  /**
   * Clears this view's status contribution when the tab closes.
   */
  public ngOnDestroy(): void {
    this.binaryStatus.clear(this.tabId());
    this.binaryDocuments.release(this.tabId());
  }

  /**
   * Records the scroll position as the grid scrolls, moving the rendered window.
   * @param event The scroll event.
   */
  protected onScroll(event: Event): void {
    const element: HTMLElement = event.target as HTMLElement;
    this.scrollTop.set(element.scrollTop);
    this.viewportHeight.set(element.clientHeight);
  }

  /**
   * Begins a selection at a byte, moving the cursor there.
   * @param offset The byte offset the pointer went down on.
   * @param event The originating pointer event.
   */
  protected onCellDown(offset: number, event: PointerEvent): void {
    event.preventDefault();
    const document: BinaryDocumentEntry | undefined = this.document();
    if (document === undefined) {
      return;
    }
    this.selecting = true;
    this.anchor = offset;
    document.cursor.set(offset);
    document.selection.set({ start: offset, end: offset + 1 });
  }

  /**
   * Extends the selection to a byte while a drag is in progress.
   * @param offset The byte offset the pointer moved over.
   */
  protected onCellEnter(offset: number): void {
    if (!this.selecting) {
      return;
    }
    const document: BinaryDocumentEntry | undefined = this.document();
    if (document === undefined) {
      return;
    }
    const start: number = Math.min(this.anchor, offset);
    const end: number = Math.max(this.anchor, offset) + 1;
    document.cursor.set(offset);
    document.selection.set({ start, end });
  }

  /**
   * Ends a selection drag when the pointer is released anywhere.
   */
  protected onPointerUp(): void {
    this.selecting = false;
  }

  /**
   * Maps a byte to its printable ASCII character, or `·` for control and non-ASCII bytes.
   * @param value The byte value.
   * @returns Returns the printable character, or `·`.
   */
  private printable(value: number): string {
    return value >= 0x20 && value <= 0x7e ? String.fromCharCode(value) : '·';
  }
}
