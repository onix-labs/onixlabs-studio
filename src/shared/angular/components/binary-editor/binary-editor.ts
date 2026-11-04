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
  output,
  OutputEmitterRef,
  signal,
  Signal,
  viewChild,
  WritableSignal,
} from '@angular/core';
import { Log } from '@shared/angular/services/log/log';
import { Settings } from '@shared/angular/services/settings/settings';
import type {
  BinaryAddressFormat,
  BinaryHexCase,
  BinaryTextEncoding,
} from '@shared/angular/services/settings/settings-registry';

/**
 * Specifies the fixed height, in pixels, of one byte-row. Fixed so the total scroll height is the row
 * count times this, and the visible window maps directly to a scroll offset.
 */
const ROW_HEIGHT: number = 26;

/**
 * Specifies how tall a row grows with a font too large for {@link ROW_HEIGHT}.
 */
const ROW_HEIGHT_PER_FONT_SIZE: number = 1.6;

/**
 * Specifies the gap between a row's byte groups.
 */
const GROUP_GAP: string = '0.75ch';

/**
 * Caps the scroll sizer's height. Browsers clamp element heights around 33.5 million pixels, so a
 * gigabyte-scale file's true pixel height (its ~10⁸ rows × {@link ROW_HEIGHT}) cannot be laid out —
 * beyond the clamp the scrollbar simply could not reach most of the file. Files taller than this cap
 * switch to a compressed mapping: the sizer stays at the cap, the scrollbar position maps
 * proportionally onto the row range, and the mouse wheel moves by rows so fine scrolling stays
 * precise.
 */
const MAX_SIZER_HEIGHT: number = 24_000_000;

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
   * Gets whether a group gap follows the cell.
   */
  readonly groupEnd: boolean;

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
    '[style.font-family]': 'fontFamily()',
    '[style.font-size.px]': 'fontSize()',
    '(window:pointerup)': 'onPointerUp()',
  },
})
export class BinaryEditor {
  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

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
   * Gets whether the bytes are locked against typing. The caret and selection still move.
   */
  public readonly readOnly: InputSignal<boolean> = input<boolean>(false);

  /**
   * Holds the Binary settings the grid draws itself by.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Gets how many bytes sit between group gaps, or zero for none.
   */
  protected readonly grouping: Signal<number> = this.settings.value('binaryEditor.byteGrouping');

  /**
   * Gets whether the text column is shown.
   */
  protected readonly showText: Signal<boolean> = this.settings.value('binaryEditor.showTextColumn');

  /**
   * Gets the gaps a row's groups add, for the grid's width.
   */
  protected readonly groupGaps: Signal<string> = computed((): string => {
    const grouping: number = this.grouping();
    const gaps: number = grouping === 0 ? 0 : Math.floor((this.bytesPerRow() - 1) / grouping);
    return `calc(${gaps} * ${GROUP_GAP})`;
  });

  /**
   * Gets the text column's heading.
   */
  protected readonly textHeading: Signal<string> = computed(
    (): string => TEXT_HEADINGS[this.settings.get('binaryEditor.textEncoding')],
  );

  /**
   * Gets the Code font's size, which the grid is set in.
   */
  protected readonly fontSize: Signal<number> = computed(
    (): number => this.settings.globalTextEditor().fontSize,
  );

  /**
   * Gets the Code font as a CSS stack, which the grid is set in.
   */
  protected readonly fontFamily: Signal<string> = computed(
    (): string =>
      `"${this.settings.globalTextEditor().fontFamily}", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`,
  );

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
   * Holds the fractional row index at the top of the viewport — the single authority every row
   * calculation flows from. Below the sizer cap it mirrors `scrollTop / ROW_HEIGHT`; above the cap
   * (compressed mapping) it is set directly by wheel steps, reveals and caret moves, and derived
   * proportionally from the scrollbar when the user drags it.
   */
  private readonly anchorRow: WritableSignal<number> = signal<number>(0);

  /**
   * Holds whether the next scroll event is this component's own `scrollTop` write (a wheel step,
   * reveal, or caret nudge under the compressed mapping), so it must not re-derive {@link anchorRow}
   * from the coarse scrollbar position and destroy the precise row it was just given.
   */
  private suppressScrollSync: boolean = false;

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
  protected readonly rowHeight: Signal<number> = computed((): number =>
    Math.max(ROW_HEIGHT, Math.round(this.fontSize() * ROW_HEIGHT_PER_FONT_SIZE)),
  );

  /**
   * Holds the column header labels (byte index within a row, as hex).
   */
  protected readonly columnLabels: Signal<readonly string[]> = computed((): readonly string[] =>
    Array.from({ length: this.bytesPerRow() }, (_unused: unknown, index: number): string =>
      formatHex(index, this.settings.get('binaryEditor.hexCase')),
    ),
  );

  /**
   * Holds the total number of rows in the file.
   */
  protected readonly rowCount: Signal<number> = computed((): number =>
    Math.ceil(this.size() / this.bytesPerRow()),
  );

  /**
   * Holds the sizer's height, in pixels: the true pixel height below {@link MAX_SIZER_HEIGHT}, the
   * cap above it (the compressed mapping takes over).
   */
  protected readonly totalHeight: Signal<number> = computed((): number =>
    Math.min(this.rowCount() * this.rowHeight(), MAX_SIZER_HEIGHT),
  );

  /**
   * Holds whether the file is too tall for true pixel layout, so scroll positions map
   * proportionally onto rows instead of one row per {@link ROW_HEIGHT} pixels.
   */
  private readonly compressed: Signal<boolean> = computed(
    (): boolean => this.rowCount() * this.rowHeight() > MAX_SIZER_HEIGHT,
  );

  /**
   * Holds the largest {@link anchorRow} value: the row index at which the last viewport-full of
   * rows begins.
   */
  private readonly maxAnchorRow: Signal<number> = computed((): number =>
    Math.max(0, this.rowCount() - this.viewportHeight() / this.rowHeight()),
  );

  /**
   * Holds the index of the first rendered row (including overscan).
   */
  private readonly firstRow: Signal<number> = computed((): number =>
    Math.max(0, Math.floor(this.anchorRow()) - OVERSCAN),
  );

  /**
   * Holds the index one past the last rendered row.
   */
  private readonly lastRow: Signal<number> = computed((): number => {
    const visible: number = Math.ceil(this.viewportHeight() / this.rowHeight()) + OVERSCAN * 2;
    return Math.min(this.rowCount(), this.firstRow() + visible);
  });

  /**
   * Holds the pixel offset the rendered window is translated by. The window is positioned so the
   * anchor row sits exactly at the scroll offset (the viewport top), with the overscan rows above
   * it; below the sizer cap this reduces to the classic `firstRow × ROW_HEIGHT`.
   */
  protected readonly offsetY: Signal<number> = computed(
    (): number => this.scrollTop() - (this.anchorRow() - this.firstRow()) * this.rowHeight(),
  );

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
      const hexCase: BinaryHexCase = this.settings.get('binaryEditor.hexCase');
      const encoding: BinaryTextEncoding = this.settings.get('binaryEditor.textEncoding');
      const addresses: BinaryAddressFormat = this.settings.get('binaryEditor.addressFormat');
      const grouping: number = this.grouping();
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
            hex: value === null ? '··' : formatHex(value, hexCase),
            ascii: value === null ? '·' : textOf(offset, value, encoding, byteAt),
            selected,
            groupEnd: endsGroup(column, grouping, bytesPerRow),
          });
        }
        rows.push({ index: row, address: formatAddress(base, addresses, hexCase), cells });
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
      this.log.info('BinaryEditor', `Mounted grid over ${this.size()} bytes`);
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
      this.scrollToRow(targetRow - element.clientHeight / this.rowHeight() / 2, element);
    });
  }

  /**
   * Records the scroll position as the grid scrolls, moving the rendered window. A scrollbar-driven
   * scroll re-derives the anchor row (proportionally under the compressed mapping); a scroll this
   * component itself initiated keeps the precise anchor it was given.
   * @param event The scroll event.
   */
  protected onScroll(event: Event): void {
    const element: HTMLElement = event.target as HTMLElement;
    this.scrollTop.set(element.scrollTop);
    this.viewportHeight.set(element.clientHeight);
    if (this.suppressScrollSync) {
      this.suppressScrollSync = false;
      return;
    }
    if (!this.compressed()) {
      this.anchorRow.set(element.scrollTop / this.rowHeight());
      return;
    }
    const scrollable: number = Math.max(1, element.scrollHeight - element.clientHeight);
    this.anchorRow.set((element.scrollTop / scrollable) * this.maxAnchorRow());
  }

  /**
   * Steps the anchor row by the wheel delta under the compressed mapping, where native pixel
   * scrolling would jump thousands of rows per pixel. Below the sizer cap native scrolling is
   * row-accurate and the event is left alone.
   * @param event The wheel event.
   */
  protected onWheel(event: WheelEvent): void {
    if (!this.compressed()) {
      return;
    }
    const element: HTMLElement | undefined = this.scroller()?.nativeElement;
    if (element === undefined) {
      return;
    }
    event.preventDefault();
    this.scrollToRow(this.anchorRow() + event.deltaY / this.rowHeight(), element);
  }

  /**
   * Moves the viewport so the given (fractional) row sits at its top, clamped to the file, keeping
   * the anchor row and the scrollbar in agreement under either mapping.
   * @param row The target anchor row.
   * @param element The scroll container.
   */
  private scrollToRow(row: number, element: HTMLElement): void {
    const clamped: number = Math.min(Math.max(0, row), this.maxAnchorRow());
    if (!this.compressed()) {
      // The scroll event derives the anchor back from this exact pixel position.
      element.scrollTop = clamped * this.rowHeight();
      return;
    }
    this.anchorRow.set(clamped);
    const scrollable: number = Math.max(1, element.scrollHeight - element.clientHeight);
    const top: number =
      this.maxAnchorRow() === 0 ? 0 : (clamped / this.maxAnchorRow()) * scrollable;
    // Only suppress the echo when the write will actually raise a scroll event.
    if (element.scrollTop !== top) {
      this.suppressScrollSync = true;
      element.scrollTop = top;
    }
    this.scrollTop.set(element.scrollTop);
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
    } else if (key === 'Backspace' && !this.readOnly()) {
      this.deleteAt(caret - 1, maxCaret);
    } else if (key === 'Delete' && !this.readOnly()) {
      this.deleteAt(caret, maxCaret);
    } else if (key === 'Tab') {
      this.activeColumn.update((column: BinaryColumn): BinaryColumn =>
        column === 'hex' ? 'ascii' : 'hex',
      );
      this.nibbleLow = false;
    } else if (this.readOnly()) {
      handled = false;
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
    const viewportRows: number = element.clientHeight / this.rowHeight();
    if (row < this.anchorRow()) {
      this.scrollToRow(row, element);
    } else if (row + 1 > this.anchorRow() + viewportRows) {
      this.scrollToRow(row + 1 - viewportRows, element);
    }
  }
}

/**
 * Formats a byte offset as a `HHHH:LLLL` hex address, splitting the value into high and low words so
 * long addresses stay readable. The Binary Editor's status strip writes its offset the same way, so
 * the two can be compared at a glance (#882).
 * @param offset The byte offset.
 * @returns Returns the formatted address.
 */
export function formatAddress(
  offset: number,
  format: BinaryAddressFormat = 'hex-split',
  hexCase: BinaryHexCase = 'upper',
): string {
  if (format === 'decimal') {
    return offset.toString(10).padStart(DECIMAL_ADDRESS_WIDTH, '0');
  }
  const hex: string = formatHex(offset, hexCase, HEX_ADDRESS_WIDTH);
  return format === 'hex' ? hex : `${hex.slice(0, -4)}:${hex.slice(-4)}`;
}

/**
 * Writes a number as hex.
 * @param value The number.
 * @param hexCase The case to write it in.
 * @param width The digits to pad to.
 * @returns Returns the hex.
 */
function formatHex(value: number, hexCase: BinaryHexCase, width: number = 2): string {
  const hex: string = value.toString(16).padStart(width, '0');
  return hexCase === 'upper' ? hex.toUpperCase() : hex;
}

/**
 * Determines whether a group gap follows a column.
 * @param column The column's index in its row.
 * @param grouping The bytes in a group, or zero for none.
 * @param bytesPerRow The bytes in a row.
 * @returns Returns true when a gap follows it.
 */
function endsGroup(column: number, grouping: number, bytesPerRow: number): boolean {
  return grouping > 0 && (column + 1) % grouping === 0 && column + 1 < bytesPerRow;
}

/**
 * Finds the character a byte shows in the text column. In UTF-8 a sequence shows on its first byte,
 * and the rest of it shows the placeholder.
 * @param offset The byte's offset.
 * @param value The byte's value.
 * @param encoding The Text Column Encoding setting.
 * @param byteAt Reads a neighbouring byte.
 * @returns Returns the character, or `·`.
 */
export function textOf(
  offset: number,
  value: number,
  encoding: BinaryTextEncoding,
  byteAt: (offset: number) => number | null,
): string {
  if (encoding === 'latin1' && value >= LATIN1_PRINTABLE) {
    return String.fromCharCode(value);
  }
  if (encoding === 'utf8' && value >= UTF8_LEAD_2) {
    const length: number = value >= UTF8_LEAD_4 ? 4 : value >= UTF8_LEAD_3 ? 3 : 2;
    const bytes: number[] = [value];
    for (let next: number = 1; next < length; next += 1) {
      bytes.push(byteAt(offset + next) ?? 0);
    }
    return (
      UTF8.decode(new Uint8Array(bytes))
        .replace(/\uFFFD/g, '·')
        .slice(0, 2) || '·'
    );
  }
  return printable(value);
}

/**
 * Holds the first printable byte of Latin-1 above the control range.
 */
const LATIN1_PRINTABLE: number = 0xa1;

/**
 * Holds the lowest lead byte of a two-byte UTF-8 sequence.
 */
const UTF8_LEAD_2: number = 0xc2;

/**
 * Holds the lowest lead byte of a three-byte UTF-8 sequence.
 */
const UTF8_LEAD_3: number = 0xe0;

/**
 * Holds the lowest lead byte of a four-byte UTF-8 sequence.
 */
const UTF8_LEAD_4: number = 0xf0;

/**
 * Holds the decoder the text column reads UTF-8 with.
 */
const UTF8: TextDecoder = new TextDecoder('utf-8');

/**
 * Holds the digits a hex address is padded to.
 */
const HEX_ADDRESS_WIDTH: number = 8;

/**
 * Holds the digits a decimal address is padded to, which fit the same column.
 */
const DECIMAL_ADDRESS_WIDTH: number = 9;

/**
 * Holds the text column's heading for each encoding.
 */
const TEXT_HEADINGS: Readonly<Record<BinaryTextEncoding, string>> = {
  ascii: 'ASCII',
  latin1: 'Latin-1',
  utf8: 'UTF-8',
};

/**
 * Maps a byte to its printable ASCII character, or `·` for control and non-ASCII bytes.
 * @param value The byte value.
 * @returns Returns the printable character, or `·`.
 */
function printable(value: number): string {
  return value >= 0x20 && value <= 0x7e ? String.fromCharCode(value) : '·';
}
