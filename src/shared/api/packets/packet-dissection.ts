import { DissectedPacket, HostNameSighting, PacketField, PacketLayer } from './packet-model';
import { PacketBytes } from './packet-bytes';

/**
 * Matches a host name worth remembering: dotted labels of letters, digits, hyphens and underscores
 * (service names such as `_dns-sd._udp.local` carry them), at most 253 characters.
 */
const HOST_NAME: RegExp =
  /^(?=.{1,253}$)[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?(?:\.[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?)*$/;

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
   * Gets the IP address the packet was sent to, without a port, once its IP layer is read.
   */
  public destinationAddress: string = '';

  /**
   * Gets the host names the packet names for addresses: a DNS response's answers, a TLS Client
   * Hello's server name.
   */
  public readonly hostNames: HostNameSighting[] = [];

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
   * Notes a host name the packet names for an address, when both look like what they are.
   * @param name The name, as the packet writes it.
   * @param address The address it stands for.
   */
  public sight(name: string, address: string): void {
    const lowered: string = name.toLowerCase().replace(/\.$/, '');
    if (address.length > 0 && HOST_NAME.test(lowered)) {
      this.hostNames.push({ name: lowered, address });
    }
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
