import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  input,
  InputSignal,
  output,
  OutputEmitterRef,
  signal,
  Signal,
  viewChild,
  WritableSignal,
} from '@angular/core';

/**
 * Specifies the fixed height, in pixels, of one byte-row. Fixed so the total scroll height is the row
 * count times this, and the visible window maps directly to a scroll offset.
 */
const ROW_HEIGHT: number = 26;

/**
 * Specifies how many extra rows are rendered above and below the viewport, so scrolling does not
 * reveal blank rows before the next frame renders.
 */
const OVERSCAN: number = 8;

/**
 * Represents a contiguous byte selection: the first selected offset and one past the last.
 */
export interface BinaryRange {
  /**
   * Gets the first selected byte offset.
   */
  readonly start: number;

  /**
   * Gets the offset one past the last selected byte.
   */
  readonly end: number;
}

/**
 * Identifies which column the caret edits: the hex pairs or the ASCII characters.
 */
export type BinaryColumn = 'hex' | 'ascii';

/**
 * Represents an edit the user typed: overwriting or inserting a byte, or deleting a run. The host
 * applies it to the document model.
 */
export type BinaryEditOp =
  | { readonly kind: 'overwrite'; readonly offset: number; readonly value: number }
  | { readonly kind: 'insert'; readonly offset: number; readonly value: number }
  | { readonly kind: 'delete'; readonly offset: number; readonly count: number };

/**
 * Represents the byte window the editor currently shows, so the host can load exactly those bytes.
 */
export interface BinaryVisibleRange {
  /**
   * Gets the first visible byte offset.
   */
  readonly offset: number;

  /**
   * Gets the number of visible bytes.
   */
  readonly length: number;
}

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
interface BinaryEditorRow {
  /**
   * Gets the zero-based row index, used as the render track key.
   */
  readonly index: number;

  /**
   * Gets the row's address (the offset of its first byte) as `HHHH:LLLL` hex.
   */
  readonly address: string;

  /**
   * Gets the row's byte cells (fewer than a full row on the final row).
   */
  readonly cells: readonly BinaryCell[];
}

/**
 * Represents the shared binary editor: a fixed-width Offset · Hex · ASCII grid over a file's bytes,
 * virtualised by hand so only the visible rows exist in the DOM. It is a thin presentation wrapper —
 * it owns no data. The host supplies the byte count, a random-access `byteAt` accessor into its own
 * cache, and the current selection; the editor renders the visible rows, reports which byte window it
 * needs so the host can load it, and reports selection and cursor changes back. Read-only for now.
 *
 * The grid centres itself in the available width and scrolls horizontally when the row is wider than
 * the viewport; the column header shares the grid's horizontal scroll so it always stays aligned.
 */
@Component({
  selector: 'app-binary-editor',
  templateUrl: './binary-editor.html',
  styleUrl: './binary-editor.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(window:pointerup)': 'onPointerUp()',
  },
})
export class BinaryEditor {
  /**
   * Gets the total number of bytes in the file.
   */
  public readonly size: InputSignal<number> = input<number>(0);

  /**
   * Gets how many bytes are shown per row.
   */
  public readonly bytesPerRow: InputSignal<number> = input<number>(16);

  /**
   * Gets the random-access byte accessor: the byte value at an offset, or null when it has not loaded.
   */
  public readonly byteAt: InputSignal<(offset: number) => number | null> =
    input.required<(offset: number) => number | null>();

  /**
   * Gets the current selection, or null when nothing is selected.
   */
  public readonly selection: InputSignal<BinaryRange | null> = input<BinaryRange | null>(null);

  /**
   * Gets a version counter the host bumps whenever loaded bytes change, so newly-arrived bytes replace
   * their placeholders.
   */
  public readonly dataVersion: InputSignal<number> = input<number>(0);

  /**
   * Gets the byte offset to scroll into view, or null when there is no pending reveal.
   */
  public readonly revealOffset: InputSignal<number | null> = input<number | null>(null);

  /**
   * Gets a version counter the host bumps to request a scroll to {@link revealOffset}, even when the
   * target offset is unchanged.
   */
  public readonly revealVersion: InputSignal<number> = input<number>(0);

  /**
   * Gets whether typing inserts bytes (true) or overwrites them (false, the default).
   */
  public readonly insertMode: InputSignal<boolean> = input<boolean>(false);

  /**
   * Emits the byte window the editor needs loaded whenever the visible range changes.
   */
  public readonly visibleRangeChange: OutputEmitterRef<BinaryVisibleRange> =
    output<BinaryVisibleRange>();

  /**
   * Emits the new selection as the user selects bytes.
   */
  public readonly selectionChange: OutputEmitterRef<BinaryRange> = output<BinaryRange>();

  /**
   * Emits the cursor's byte offset as the user moves it.
   */
  public readonly cursorChange: OutputEmitterRef<number> = output<number>();

  /**
   * Emits an edit — overwrite, insert, or delete — as the user types over the hex or ASCII columns.
   */
  public readonly op: OutputEmitterRef<BinaryEditOp> = output<BinaryEditOp>();

  /**
   * Emits when the user presses Insert to toggle between insert and overwrite typing.
   */
  public readonly toggleInsertMode: OutputEmitterRef<void> = output<void>();

  /**
   * Emits the offset of a double-clicked byte, so the host can snap the selection to the whole
   * instruction (or unit) that contains it.
   */
  public readonly unitSelect: OutputEmitterRef<number> = output<number>();

  /**
   * Holds the scroll container, measured for the viewport height and driven for reveals.
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
   * Holds the caret's byte offset, where typed edits are applied. Follows the selection start.
   */
  protected readonly caret: WritableSignal<number> = signal<number>(0);

  /**
   * Holds which column the caret edits (the hex pairs or the ASCII characters).
   */
  protected readonly activeColumn: WritableSignal<BinaryColumn> = signal<BinaryColumn>('hex');

  /**
   * Holds whether the next hex digit typed sets the caret byte's low nibble (the second of the pair).
   */
  private nibbleLow: boolean = false;

  /**
   * Gets the fixed row height, exposed for the template's inline sizing.
   */
  protected readonly rowHeight: number = ROW_HEIGHT;

  /**
   * Holds the column header labels (byte index within a row, as hex).
   */
  protected readonly columnLabels: Signal<readonly string[]> = computed((): readonly string[] =>
    Array.from({ length: this.bytesPerRow() }, (_unused: unknown, index: number): string =>
      index.toString(16).padStart(2, '0').toUpperCase(),
    ),
  );

  /**
   * Holds the total number of rows in the file.
   */
  protected readonly rowCount: Signal<number> = computed((): number =>
    Math.ceil(this.size() / this.bytesPerRow()),
  );

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
  protected readonly rows: Signal<readonly BinaryEditorRow[]> = computed(
    (): readonly BinaryEditorRow[] => {
      // Re-run whenever loaded bytes change so newly-loaded bytes replace their placeholders.
      this.dataVersion();
      const bytesPerRow: number = this.bytesPerRow();
      const size: number = this.size();
      const selection: BinaryRange | null = this.selection();
      const byteAt: (offset: number) => number | null = this.byteAt();
      const first: number = this.firstRow();
      const last: number = this.lastRow();
      const rows: BinaryEditorRow[] = [];
      for (let row: number = first; row < last; row += 1) {
        const base: number = row * bytesPerRow;
        const cells: BinaryCell[] = [];
        for (let column: number = 0; column < bytesPerRow; column += 1) {
          const offset: number = base + column;
          if (offset >= size) {
            break;
          }
          const value: number | null = byteAt(offset);
          const selected: boolean =
            selection !== null && offset >= selection.start && offset < selection.end;
          cells.push({
            offset,
            hex: value === null ? '··' : value.toString(16).padStart(2, '0').toUpperCase(),
            ascii: value === null ? '·' : printable(value),
            selected,
          });
        }
        rows.push({ index: row, address: formatAddress(base), cells });
      }
      return rows;
    },
  );

  /**
   * Initializes the editor: measures the viewport, reports the visible byte window as it moves, and
   * honours reveal requests.
   */
  public constructor() {
    afterNextRender((): void => {
      const element: HTMLElement | undefined = this.scroller()?.nativeElement;
      if (element === undefined || typeof ResizeObserver === 'undefined') {
        return;
      }
      this.viewportHeight.set(element.clientHeight);
      const observer: ResizeObserver = new ResizeObserver((): void => {
        this.viewportHeight.set(element.clientHeight);
      });
      observer.observe(element);
    });

    // Report the visible byte window whenever it moves, so the host loads exactly those bytes.
    effect((): void => {
      const first: number = this.firstRow();
      const last: number = this.lastRow();
      if (last <= first) {
        return;
      }
      const bytesPerRow: number = this.bytesPerRow();
      this.visibleRangeChange.emit({
        offset: first * bytesPerRow,
        length: (last - first) * bytesPerRow,
      });
    });

    // Keep the caret on the selection's first byte, so an external selection (a disassembly click)
    // moves the edit caret with it.
    effect((): void => {
      const selection: BinaryRange | null = this.selection();
      if (selection !== null) {
        this.caret.set(selection.start);
      }
    });

    // Scroll to bring a reveal target into view, re-running when the host bumps the reveal version.
    effect((): void => {
      this.revealVersion();
      const target: number | null = this.revealOffset();
      const element: HTMLElement | undefined = this.scroller()?.nativeElement;
      if (target === null || element === undefined) {
        return;
      }
      const targetRow: number = Math.floor(target / this.bytesPerRow());
      const centred: number = targetRow * ROW_HEIGHT - element.clientHeight / 2;
      element.scrollTop = Math.max(0, centred);
    });
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
   * Begins a selection at a byte, moving the caret there and focusing the grid so typed edits land.
   * @param offset The byte offset the pointer went down on.
   * @param column The column that was clicked (hex or ASCII), which the caret then edits.
   * @param event The originating pointer event.
   */
  protected onCellDown(offset: number, column: BinaryColumn, event: PointerEvent): void {
    event.preventDefault();
    this.selecting = true;
    this.anchor = offset;
    this.caret.set(offset);
    this.activeColumn.set(column);
    this.nibbleLow = false;
    this.scroller()?.nativeElement.focus();
    this.cursorChange.emit(offset);
    this.selectionChange.emit({ start: offset, end: offset + 1 });
  }

  /**
   * Reports a double-clicked byte, so the host can snap the selection to the instruction containing it.
   * @param offset The byte offset that was double-clicked.
   */
  protected onCellDouble(offset: number): void {
    this.unitSelect.emit(offset);
  }

  /**
   * Handles keyboard input: arrow/Home/End move the caret, Insert toggles insert mode, Backspace and
   * Delete remove bytes, Tab switches column, and hex digits or printable characters overwrite (or, in
   * insert mode, insert) the caret byte.
   * @param event The keyboard event.
   */
  protected onKeyDown(event: KeyboardEvent): void {
    const size: number = this.size();
    const insertMode: boolean = this.insertMode();
    // In insert mode the caret may sit one past the last byte (the append point).
    const maxCaret: number = insertMode ? size : Math.max(0, size - 1);
    const bytesPerRow: number = this.bytesPerRow();
    const caret: number = this.caret();
    const key: string = event.key;
    let handled: boolean = true;
    if (key === 'ArrowRight') {
      this.moveCaret(caret + 1, maxCaret);
    } else if (key === 'ArrowLeft') {
      this.moveCaret(caret - 1, maxCaret);
    } else if (key === 'ArrowDown') {
      this.moveCaret(caret + bytesPerRow, maxCaret);
    } else if (key === 'ArrowUp') {
      this.moveCaret(caret - bytesPerRow, maxCaret);
    } else if (key === 'Home') {
      this.moveCaret(caret - (caret % bytesPerRow), maxCaret);
    } else if (key === 'End') {
      this.moveCaret(caret - (caret % bytesPerRow) + bytesPerRow - 1, maxCaret);
    } else if (key === 'Insert') {
      this.toggleInsertMode.emit();
    } else if (key === 'Backspace') {
      this.deleteAt(caret - 1, maxCaret);
    } else if (key === 'Delete') {
      this.deleteAt(caret, maxCaret);
    } else if (key === 'Tab') {
      this.activeColumn.update((column: BinaryColumn): BinaryColumn =>
        column === 'hex' ? 'ascii' : 'hex',
      );
      this.nibbleLow = false;
    } else if (this.activeColumn() === 'hex' && /^[0-9a-fA-F]$/.test(key)) {
      this.applyHexDigit(parseInt(key, 16), maxCaret, insertMode);
    } else if (
      this.activeColumn() === 'ascii' &&
      key.length === 1 &&
      key.charCodeAt(0) >= 0x20 &&
      key.charCodeAt(0) <= 0x7e
    ) {
      this.typeByte(key.charCodeAt(0), maxCaret, insertMode);
    } else {
      handled = false;
    }
    if (handled) {
      event.preventDefault();
      this.ensureCaretVisible();
    }
  }

  /**
   * Extends the selection to a byte while a drag is in progress.
   * @param offset The byte offset the pointer moved over.
   */
  protected onCellEnter(offset: number): void {
    if (!this.selecting) {
      return;
    }
    const start: number = Math.min(this.anchor, offset);
    const end: number = Math.max(this.anchor, offset) + 1;
    this.cursorChange.emit(offset);
    this.selectionChange.emit({ start, end });
  }

  /**
   * Ends a selection drag when the pointer is released anywhere.
   */
  protected onPointerUp(): void {
    this.selecting = false;
  }

  /**
   * Moves the caret to an offset (clamped to the file), resetting the nibble and reporting the new
   * single-byte selection so the highlight and inspector follow.
   * @param offset The target offset.
   * @param maxOffset The last valid offset.
   */
  private moveCaret(offset: number, maxOffset: number): void {
    const clamped: number = Math.max(0, Math.min(offset, maxOffset));
    this.caret.set(clamped);
    this.nibbleLow = false;
    this.cursorChange.emit(clamped);
    this.selectionChange.emit({ start: clamped, end: clamped + 1 });
  }

  /**
   * Applies a typed hex digit to the caret byte, a nibble at a time. In overwrite mode both nibbles
   * overwrite the byte; in insert mode the first nibble inserts a new byte (high nibble set) and the
   * second overwrites its low nibble. Completing the second nibble advances the caret.
   * @param digit The hex digit value (0–15).
   * @param maxCaret The furthest the caret may move.
   * @param insertMode Whether typing inserts (true) or overwrites (false).
   */
  private applyHexDigit(digit: number, maxCaret: number, insertMode: boolean): void {
    const offset: number = this.caret();
    if (this.nibbleLow) {
      const current: number = this.byteAt()(offset) ?? 0;
      this.op.emit({ kind: 'overwrite', offset, value: (current & 0xf0) | digit });
      this.moveCaret(offset + 1, insertMode ? maxCaret + 1 : maxCaret);
    } else if (insertMode) {
      this.op.emit({ kind: 'insert', offset, value: digit << 4 });
      this.nibbleLow = true;
    } else {
      const current: number = this.byteAt()(offset) ?? 0;
      this.op.emit({ kind: 'overwrite', offset, value: (digit << 4) | (current & 0x0f) });
      this.nibbleLow = true;
    }
  }

  /**
   * Overwrites or inserts a byte at the caret and advances it. Used for ASCII-column typing.
   * @param value The byte value.
   * @param maxCaret The furthest the caret may move.
   * @param insertMode Whether typing inserts (true) or overwrites (false).
   */
  private typeByte(value: number, maxCaret: number, insertMode: boolean): void {
    const offset: number = this.caret();
    this.op.emit({ kind: insertMode ? 'insert' : 'overwrite', offset, value });
    this.moveCaret(offset + 1, insertMode ? maxCaret + 1 : maxCaret);
  }

  /**
   * Deletes the byte at an offset (if any) and places the caret there.
   * @param offset The offset to delete.
   * @param maxCaret The furthest the caret may move.
   */
  private deleteAt(offset: number, maxCaret: number): void {
    if (offset < 0 || offset >= this.size()) {
      return;
    }
    this.op.emit({ kind: 'delete', offset, count: 1 });
    this.moveCaret(offset, maxCaret);
  }

  /**
   * Scrolls the caret's row into view when it moves outside the viewport.
   */
  private ensureCaretVisible(): void {
    const element: HTMLElement | undefined = this.scroller()?.nativeElement;
    if (element === undefined) {
      return;
    }
    const row: number = Math.floor(this.caret() / this.bytesPerRow());
    const top: number = row * ROW_HEIGHT;
    const bottom: number = top + ROW_HEIGHT;
    if (top < element.scrollTop) {
      element.scrollTop = top;
    } else if (bottom > element.scrollTop + element.clientHeight) {
      element.scrollTop = bottom - element.clientHeight;
    }
  }
}

/**
 * Formats a byte offset as a `HHHH:LLLL` hex address, splitting the value into high and low words so
 * long addresses stay readable.
 * @param offset The byte offset.
 * @returns Returns the formatted address.
 */
function formatAddress(offset: number): string {
  const hex: string = offset.toString(16).padStart(8, '0').toUpperCase();
  return `${hex.slice(0, -4)}:${hex.slice(-4)}`;
}

/**
 * Maps a byte to its printable ASCII character, or `·` for control and non-ASCII bytes.
 * @param value The byte value.
 * @returns Returns the printable character, or `·`.
 */
function printable(value: number): string {
  return value >= 0x20 && value <= 0x7e ? String.fromCharCode(value) : '·';
}
