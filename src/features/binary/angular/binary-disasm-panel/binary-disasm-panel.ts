import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  InputSignal,
  Signal,
} from '@angular/core';
import { BinaryDocumentEntry, BinarySelection } from '../binary-document/binary-document';
import { disassemblyArchitecture } from '../binary-format/binary-format';

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
 * Represents the disassembly side panel: the native instructions decoded for the visible byte range,
 * cross-highlighted with the hex grid. Clicking an instruction selects its bytes; a byte selection
 * highlights the instructions it overlaps. It renders the document's already-loaded instructions —
 * the loading itself is driven by the view as the viewport moves.
 */
@Component({
  selector: 'app-binary-disasm-panel',
  templateUrl: './binary-disasm-panel.html',
  styleUrl: './binary-disasm-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BinaryDisasmPanel {
  /**
   * Gets the document whose instructions are shown, or undefined when none is bound.
   */
  public readonly document: InputSignal<BinaryDocumentEntry | undefined> = input<
    BinaryDocumentEntry | undefined
  >(undefined);

  /**
   * Holds whether the document's format can be natively disassembled (drives the empty note).
   */
  protected readonly disassemblable: Signal<boolean> = computed((): boolean => {
    const document: BinaryDocumentEntry | undefined = this.document();
    return document !== undefined && disassemblyArchitecture(document.format()) !== null;
  });

  /**
   * Holds the disassembly rows for the visible range, each flagged when its bytes overlap the current
   * selection (the hex/ASCII↔disassembly cross-highlight).
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
   * Selects an instruction's bytes when it is clicked, so the hex and ASCII columns highlight the
   * bytes it decodes from.
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
