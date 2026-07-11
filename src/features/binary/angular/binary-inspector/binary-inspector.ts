import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  InputSignal,
  output,
  OutputEmitterRef,
  signal,
  Signal,
  WritableSignal,
} from '@angular/core';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { PanelDragHandle } from '@shared/angular/components/panel-layout/panel-drag-handle';
import { Icon } from '@shared/angular/icons/icon';
import { BinaryDocumentEntry } from '../binary-document/binary-document';
import { inspectBytes, InspectorRow } from './binary-inspector-values';

/**
 * Holds how many bytes from the cursor the inspector reads (enough for a 64-bit value).
 */
const INSPECT_WIDTH: number = 8;

/**
 * Represents the data-inspector side panel: it decodes the bytes at the cursor into common numeric and
 * text types, with endianness and signedness toggles. It reads from the document's already-fetched
 * block cache, so it needs no I/O of its own beyond ensuring the cursor's bytes are loaded.
 */
@Component({
  selector: 'app-binary-inspector',
  imports: [AppIcon, PanelDragHandle],
  templateUrl: './binary-inspector.html',
  styleUrl: './binary-inspector.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BinaryInspector {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the document whose cursor bytes are inspected, or undefined when none is bound.
   */
  public readonly document: InputSignal<BinaryDocumentEntry | undefined> = input<
    BinaryDocumentEntry | undefined
  >(undefined);

  /**
   * Emits when the panel's close button is pressed.
   */
  public readonly closed: OutputEmitterRef<void> = output<void>();

  /**
   * Holds whether multi-byte values are decoded little-endian.
   */
  protected readonly littleEndian: WritableSignal<boolean> = signal<boolean>(true);

  /**
   * Holds whether the integer interpretations are signed.
   */
  protected readonly signed: WritableSignal<boolean> = signal<boolean>(true);

  /**
   * Holds the decoded rows for the bytes at the cursor, or an empty list when there is no cursor.
   */
  protected readonly rows: Signal<readonly InspectorRow[]> = computed(
    (): readonly InspectorRow[] => {
      const document: BinaryDocumentEntry | undefined = this.document();
      if (document === undefined) {
        return [];
      }
      // Re-run when a block arrives so a value completes as its bytes load.
      document.loadedVersion();
      const cursor: number | null = document.cursor();
      if (cursor === null) {
        return [];
      }
      const bytes: (number | null)[] = [];
      for (let offset: number = 0; offset < INSPECT_WIDTH; offset += 1) {
        bytes.push(document.byteAt(cursor + offset));
      }
      return inspectBytes(bytes, this.littleEndian(), this.signed());
    },
  );

  /**
   * Initializes the inspector, ensuring the cursor's bytes are loaded whenever the cursor moves.
   */
  public constructor() {
    effect((): void => {
      const document: BinaryDocumentEntry | undefined = this.document();
      const cursor: number | null = document?.cursor() ?? null;
      if (document !== undefined && cursor !== null) {
        document.ensureRange(cursor, INSPECT_WIDTH);
      }
    });
  }

  /**
   * Emits the close request so the host hides the panel.
   */
  protected onClose(): void {
    this.closed.emit();
  }

  /**
   * Sets the endianness used to decode multi-byte values.
   * @param littleEndian Whether to decode little-endian.
   */
  protected setEndian(littleEndian: boolean): void {
    this.littleEndian.set(littleEndian);
  }

  /**
   * Sets whether the integer interpretations are signed.
   * @param signed Whether integers are signed.
   */
  protected setSigned(signed: boolean): void {
    this.signed.set(signed);
  }
}
