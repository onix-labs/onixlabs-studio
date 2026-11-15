import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  InputSignal,
  linkedSignal,
  Signal,
  signal,
  WritableSignal,
} from '@angular/core';
import { DissectedPacket, PacketField, PacketLayer } from '@shared/api/packets/packet-model';

/**
 * A span of a packet's bytes: what is highlighted in the hex dump.
 */
interface ByteSpan {
  /**
   * Gets the span's first byte.
   */
  readonly offset: number;

  /**
   * Gets its length.
   */
  readonly length: number;
}

/**
 * One line of the hex dump: sixteen bytes, as hex and as text.
 */
interface HexLine {
  /**
   * Gets the line's first byte's offset.
   */
  readonly offset: number;

  /**
   * Gets the line's offset as the dump shows it.
   */
  readonly label: string;

  /**
   * Gets the line's bytes, each as two hex digits and as a character.
   */
  readonly bytes: readonly HexByte[];
}

/**
 * One byte of the hex dump.
 */
interface HexByte {
  /**
   * Gets the byte's offset in the packet.
   */
  readonly offset: number;

  /**
   * Gets the byte as two hex digits.
   */
  readonly hex: string;

  /**
   * Gets the byte as a printable character, or `.`.
   */
  readonly text: string;
}

/**
 * The bytes on each line of the hex dump.
 */
const BYTES_PER_LINE: number = 16;

/**
 * One packet taken apart: each layer, collapsible, with its fields, beside the packet's bytes in hex.
 * Choosing a layer or a field highlights the bytes it was read from, the way Wireshark's panes do.
 */
@Component({
  selector: 'app-packet-details',
  templateUrl: './packet-details.html',
  styleUrl: './packet-details.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PacketDetails {
  /**
   * Gets the dissected packet, or undefined when none is chosen.
   */
  public readonly packet: InputSignal<DissectedPacket | undefined> = input<
    DissectedPacket | undefined
  >(undefined);

  /**
   * Gets the packet's bytes.
   */
  public readonly data: InputSignal<Uint8Array | undefined> = input<Uint8Array | undefined>(
    undefined,
  );

  /**
   * Holds the layers that are collapsed, by protocol; every layer starts open.
   */
  protected readonly collapsed: WritableSignal<ReadonlySet<string>> = signal<ReadonlySet<string>>(
    new Set<string>(),
  );

  /**
   * Holds the span highlighted, cleared when another packet is chosen.
   */
  protected readonly highlighted: WritableSignal<ByteSpan | undefined> = linkedSignal<
    Uint8Array | undefined,
    ByteSpan | undefined
  >({
    source: this.data,
    computation: (): ByteSpan | undefined => undefined,
  });

  /**
   * Gets the hex dump's lines.
   */
  protected readonly lines: Signal<readonly HexLine[]> = computed((): readonly HexLine[] => {
    const data: Uint8Array | undefined = this.data();
    if (data === undefined) {
      return [];
    }
    const lines: HexLine[] = [];
    for (let offset: number = 0; offset < data.length; offset += BYTES_PER_LINE) {
      lines.push({
        offset,
        label: offset.toString(16).padStart(4, '0'),
        bytes: Array.from(
          data.subarray(offset, offset + BYTES_PER_LINE),
          (byte: number, index: number): HexByte => ({
            offset: offset + index,
            hex: byte.toString(16).padStart(2, '0'),
            text: byte >= 0x20 && byte < 0x7f ? String.fromCharCode(byte) : '.',
          }),
        ),
      });
    }
    return lines;
  });

  /**
   * Gets whether a byte is highlighted.
   * @param offset The byte's offset.
   * @returns Returns true when it lies in the highlighted span.
   */
  protected isHighlighted(offset: number): boolean {
    const span: ByteSpan | undefined = this.highlighted();
    return span !== undefined && offset >= span.offset && offset < span.offset + span.length;
  }

  /**
   * Opens or closes a layer, and highlights its bytes.
   * @param layer The layer.
   */
  protected toggle(layer: PacketLayer): void {
    this.collapsed.update((collapsed: ReadonlySet<string>): ReadonlySet<string> => {
      const next: Set<string> = new Set<string>(collapsed);
      if (!next.delete(layer.protocol)) {
        next.add(layer.protocol);
      }
      return next;
    });
    this.highlighted.set({ offset: layer.offset, length: layer.length });
  }

  /**
   * Highlights a field's bytes.
   * @param fieldOfLayer The field.
   */
  protected choose(fieldOfLayer: PacketField): void {
    this.highlighted.set({ offset: fieldOfLayer.offset, length: Math.max(1, fieldOfLayer.length) });
  }
}
