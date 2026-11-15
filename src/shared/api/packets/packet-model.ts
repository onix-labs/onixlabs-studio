/**
 * The shapes a captured packet is described in, shared by the main process — which summarises every
 * packet as it is captured — and the renderer, which dissects the one the user is looking at in full.
 */

/**
 * The pcap link-layer header types this explorer reads: what the first bytes of every packet in a
 * capture are. https://www.tcpdump.org/linktypes.html
 *
 * BSD loopback: a four-byte address family in the capturing host's byte order (`lo0`, `utun`).
 */
export const LINKTYPE_NULL: number = 0;

/**
 * Ethernet II, and 802.11 presented as Ethernet (`en0` on a Mac).
 */
export const LINKTYPE_ETHERNET: number = 1;

/**
 * A bare IPv4 or IPv6 packet, no link header.
 */
export const LINKTYPE_RAW: number = 101;

/**
 * OpenBSD loopback: like {@link LINKTYPE_NULL}, but the family is in network byte order.
 */
export const LINKTYPE_LOOP: number = 108;

/**
 * Linux "cooked" capture, version 1 (`-i any`).
 */
export const LINKTYPE_LINUX_SLL: number = 113;

/**
 * One packet as a capture file records it.
 */
export interface PcapRecord {
  /**
   * Gets when the packet was captured, in milliseconds since the Unix epoch, with the fraction the
   * capture's resolution allows.
   */
  readonly timestampMs: number;

  /**
   * Gets the packet's length on the wire, which may exceed what was captured.
   */
  readonly originalLength: number;

  /**
   * Gets the bytes captured, at most the capture's snapshot length.
   */
  readonly data: Uint8Array;
}

/**
 * One field of a dissected layer: a name, what it says, and where in the packet it is.
 */
export interface PacketField {
  /**
   * Gets the field's name.
   */
  readonly label: string;

  /**
   * Gets what the field says, ready to show.
   */
  readonly value: string;

  /**
   * Gets the field's first byte in the packet.
   */
  readonly offset: number;

  /**
   * Gets the field's length in bytes; 0 for a field that is a fraction of a byte's bits.
   */
  readonly length: number;
}

/**
 * One protocol layer of a dissected packet: Ethernet, IPv4, TCP, DNS and so on.
 */
export interface PacketLayer {
  /**
   * Gets the protocol's short name: `Ethernet`, `IPv4`, `TCP`.
   */
  readonly protocol: string;

  /**
   * Gets the layer's one-line description, as a tree shows it collapsed.
   */
  readonly summary: string;

  /**
   * Gets the layer's first byte in the packet.
   */
  readonly offset: number;

  /**
   * Gets the layer's length in bytes, its payload included.
   */
  readonly length: number;

  /**
   * Gets the layer's fields, in the order they appear.
   */
  readonly fields: readonly PacketField[];
}

/**
 * Describes a packet in a line: what the packet list shows of it.
 */
export interface PacketSummary {
  /**
   * Gets the highest protocol recognised: `DNS`, `TLS`, `TCP`, `ARP`.
   */
  readonly protocol: string;

  /**
   * Gets where the packet came from: an address, with its port for TCP and UDP.
   */
  readonly source: string;

  /**
   * Gets where it was going.
   */
  readonly destination: string;

  /**
   * Gets what it says: a DNS query's name, a TCP segment's flags, a TLS handshake's server name.
   */
  readonly info: string;
}

/**
 * A packet taken apart: each layer recognised, and the line that sums it up.
 */
export interface DissectedPacket {
  /**
   * Gets the layers, outermost first.
   */
  readonly layers: readonly PacketLayer[];

  /**
   * Gets the packet's summary.
   */
  readonly summary: PacketSummary;

  /**
   * Gets whether the capture cut the packet short of a layer it was still reading.
   */
  readonly truncated: boolean;
}

/**
 * A host's name seen in a packet, with the address it stands for: a DNS answer's name and address,
 * or the server name a TLS Client Hello asked for and the address it was sent to. What an application
 * actually called the host it connected to.
 */
export interface HostNameSighting {
  /**
   * Gets the name, lower-case, without a trailing dot.
   */
  readonly name: string;

  /**
   * Gets the address the name stands for.
   */
  readonly address: string;
}
