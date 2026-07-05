import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  InputSignal,
  OnDestroy,
  signal,
  Signal,
  WritableSignal,
} from '@angular/core';
import {
  BinaryEditor,
  BinaryRange,
  BinaryVisibleRange,
} from '@shared/angular/components/binary-editor/binary-editor';
import {
  BinaryDocumentEntry,
  BinaryDocuments,
  BinarySelection,
} from '../binary-document/binary-document';
import { describeFormat, disassemblyArchitecture } from '../binary-format/binary-format';
import { BinaryInspector } from '../binary-inspector/binary-inspector';
import { BinaryStatus } from '../binary-status/binary-status';

/**
 * Describes a single rendered disassembly row.
 */
interface DisasmRow {
  /**
   * Gets the absolute file offset of the instruction's first byte (also the render track key).
   */
  readonly startOffset: number;

  /**
   * Gets the instruction's length in bytes.
   */
  readonly byteLength: number;

  /**
   * Gets the instruction address as fixed-width hex.
   */
  readonly address: string;

  /**
   * Gets the instruction mnemonic.
   */
  readonly mnemonic: string;

  /**
   * Gets the instruction operands.
   */
  readonly operands: string;

  /**
   * Gets a value indicating whether the instruction's bytes overlap the current selection.
   */
  readonly selected: boolean;
}

/**
 * Represents the binary editor's tab view: the shared {@link BinaryEditor} grid over a file's bytes,
 * beside a disassembly column and the data inspector. It owns the binary-tab concerns the grid does
 * not — resolving the backing document, loading the visible byte window and its disassembly, the
 * status segment, and the disassembly/inspector cross-highlight. Read-only for this phase.
 */
@Component({
  selector: 'app-binary-view',
  imports: [BinaryEditor, BinaryInspector],
  templateUrl: './binary-view.html',
  styleUrl: './binary-view.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
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
   * Holds the byte window the editor last reported visible, used to (re)load disassembly when the
   * format resolves or the viewport moves.
   */
  private readonly visibleRange: WritableSignal<BinaryVisibleRange | null> =
    signal<BinaryVisibleRange | null>(null);

  /**
   * Gets the identifier of the tab this view represents.
   */
  public readonly tabId: InputSignal<string> = input.required<string>();

  /**
   * Gets a value indicating whether this view belongs to the active tab.
   */
  public readonly isActive: InputSignal<boolean> = input<boolean>(false);

  /**
   * Holds the resolved binary document, or undefined when the tab has none.
   */
  protected readonly document: Signal<BinaryDocumentEntry | undefined> = computed(
    (): BinaryDocumentEntry | undefined => this.binaryDocuments.get(this.tabId()),
  );

  /**
   * Gets the random-access byte accessor handed to the editor, reading the document's block cache.
   */
  protected readonly byteAt: (offset: number) => number | null = (offset: number): number | null =>
    this.document()?.byteAt(offset) ?? null;

  /**
   * Holds whether the document's format can be natively disassembled (drives the column's empty note).
   */
  protected readonly disassemblable: Signal<boolean> = computed((): boolean => {
    const document: BinaryDocumentEntry | undefined = this.document();
    return document !== undefined && disassemblyArchitecture(document.format()) !== null;
  });

  /**
   * Holds the disassembly rows for the visible range, with each instruction flagged when its bytes
   * overlap the current selection (the hex/ASCII↔disassembly cross-highlight).
   */
  protected readonly disasmRows: Signal<readonly DisasmRow[]> = computed(
    (): readonly DisasmRow[] => {
      const document: BinaryDocumentEntry | undefined = this.document();
      if (document === undefined) {
        return [];
      }
      const selection: BinarySelection | null = document.selection();
      return document.instructions().map(
        (instruction): DisasmRow => ({
          startOffset: instruction.startOffset,
          byteLength: instruction.byteLength,
          address: instruction.startOffset.toString(16).padStart(8, '0').toUpperCase(),
          mnemonic: instruction.mnemonic,
          operands: instruction.operands,
          selected:
            selection !== null &&
            instruction.startOffset < selection.end &&
            instruction.startOffset + instruction.byteLength > selection.start,
        }),
      );
    },
  );

  /**
   * Initializes the view: loads disassembly for the visible range and publishes status while active.
   */
  public constructor() {
    // Load disassembly for the visible range (debounced in the document), re-running when the format
    // resolves or the viewport moves.
    effect((): void => {
      const document: BinaryDocumentEntry | undefined = this.document();
      const range: BinaryVisibleRange | null = this.visibleRange();
      if (document === undefined || range === null) {
        return;
      }
      document.format();
      document.loadDisassembly(range.offset, range.length);
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
          format: describeFormat(document.format()),
        });
      } else {
        this.binaryStatus.clear(this.tabId());
      }
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
   * Loads the byte window the editor reports visible, and remembers it so disassembly reloads when the
   * format resolves.
   * @param range The visible byte window.
   */
  protected onVisibleRange(range: BinaryVisibleRange): void {
    const document: BinaryDocumentEntry | undefined = this.document();
    if (document === undefined) {
      return;
    }
    this.visibleRange.set(range);
    document.ensureRange(range.offset, range.length);
  }

  /**
   * Records the selection reported by the editor onto the document, so the disassembly and inspector
   * cross-highlight follows it.
   * @param range The new selection.
   */
  protected onSelectionChange(range: BinaryRange): void {
    this.document()?.selection.set({ start: range.start, end: range.end });
  }

  /**
   * Records the cursor reported by the editor onto the document.
   * @param offset The cursor's byte offset.
   */
  protected onCursorChange(offset: number): void {
    this.document()?.cursor.set(offset);
  }

  /**
   * Selects an instruction's bytes when it is clicked in the disassembly column, so the hex and ASCII
   * columns highlight the bytes it decodes from.
   * @param startOffset The instruction's first byte offset.
   * @param byteLength The instruction's length in bytes.
   */
  protected onInstructionClick(startOffset: number, byteLength: number): void {
    const document: BinaryDocumentEntry | undefined = this.document();
    if (document === undefined) {
      return;
    }
    document.cursor.set(startOffset);
    document.selection.set({ start: startOffset, end: startOffset + byteLength });
  }
}
