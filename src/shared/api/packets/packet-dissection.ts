import { DissectedPacket, PacketField, PacketLayer } from './packet-model';
import { PacketBytes } from './packet-bytes';

/**
 * A packet being taken apart: the layers recognised so far, and what each has said about the packet
 * as a whole. Each dissector adds its layer and, being further in, overrides what the packet is called
 * and what its summary says.
 */
export class PacketDissection {
  /**
   * Holds the layers, outermost first.
   */
  private readonly layers: PacketLayer[] = [];

  /**
   * Gets the highest protocol recognised so far.
   */
  public protocol: string = 'Unknown';

  /**
   * Gets where the packet came from, as best known so far.
   */
  public source: string = '';

  /**
   * Gets where it was going, as best known so far.
   */
  public destination: string = '';

  /**
   * Gets what it says, as best known so far.
   */
  public info: string = '';

  /**
   * Gets whether the packet ended before a layer did.
   */
  public truncated: boolean = false;

  /**
   * Starts a dissection.
   * @param bytes The packet.
   */
  public constructor(public readonly bytes: PacketBytes) {}

  /**
   * Adds a layer, and makes it the one the packet is called by.
   * @param protocol The protocol's short name.
   * @param summary The layer's one-line description.
   * @param offset The layer's first byte.
   * @param length The layer's length, its payload included.
   * @param fields The layer's fields.
   */
  public add(
    protocol: string,
    summary: string,
    offset: number,
    length: number,
    fields: readonly PacketField[],
  ): void {
    this.layers.push({ protocol, summary, offset, length, fields });
    this.protocol = protocol;
  }

  /**
   * Notes that the packet ended part-way through a layer.
   * @returns Returns false, so a dissector can `return dissection.cut()`.
   */
  public cut(): false {
    this.truncated = true;
    return false;
  }

  /**
   * Finishes the dissection.
   * @returns Returns the dissected packet.
   */
  public finish(): DissectedPacket {
    return {
      layers: this.layers,
      summary: {
        protocol: this.protocol,
        source: this.source,
        destination: this.destination,
        info: this.info,
      },
      truncated: this.truncated,
    };
  }
}

/**
 * Builds a field.
 * @param label The field's name.
 * @param value What it says.
 * @param offset Its first byte.
 * @param length Its length in bytes.
 * @returns Returns the field.
 */
export function field(label: string, value: string, offset: number, length: number): PacketField {
  return { label, value, offset, length };
}
