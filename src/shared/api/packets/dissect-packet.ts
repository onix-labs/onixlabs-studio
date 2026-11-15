import {
  DissectedPacket,
  LINKTYPE_ETHERNET,
  LINKTYPE_LINUX_SLL,
  LINKTYPE_LOOP,
  LINKTYPE_NULL,
  LINKTYPE_RAW,
} from './packet-model';
import { formatIpv4, formatIpv6, formatMac, PacketBytes } from './packet-bytes';
import { field, PacketDissection } from './packet-dissection';
import { dissectTransport } from './dissect-transport';

/**
 * Names the IP protocols a packet's protocol column names when nothing further in is recognised.
 */
const IP_PROTOCOLS: Readonly<Record<number, string>> = {
  1: 'ICMP',
  2: 'IGMP',
  6: 'TCP',
  17: 'UDP',
  41: 'IPv6',
  47: 'GRE',
  50: 'ESP',
  58: 'ICMPv6',
  132: 'SCTP',
};

/**
 * The IPv6 extension headers that are walked past to reach what the packet carries.
 */
const IPV6_EXTENSIONS: ReadonlySet<number> = new Set<number>([0, 43, 44, 60]);

/**
 * Takes apart an ARP message: who is asking for whom, or who answers.
 * @param dissection The packet's dissection.
 * @param start The message's first byte.
 */
function dissectArp(dissection: PacketDissection, start: number): void {
  const bytes: PacketBytes = dissection.bytes;
  const hardwareLength: number | undefined = bytes.u8(start + 4);
  const protocolLength: number | undefined = bytes.u8(start + 5);
  const operation: number | undefined = bytes.u16(start + 6);
  if (
    hardwareLength !== 6 ||
    protocolLength !== 4 ||
    operation === undefined ||
    !bytes.has(start, 28)
  ) {
    dissection.cut();
    return;
  }
  const senderMac: string = formatMac(bytes.slice(start + 8, 6));
  const senderIp: string = formatIpv4(bytes.slice(start + 14, 4));
  const targetMac: string = formatMac(bytes.slice(start + 18, 6));
  const targetIp: string = formatIpv4(bytes.slice(start + 24, 4));
  const request: boolean = operation === 1;
  dissection.add(
    'ARP',
    `Address Resolution Protocol (${request ? 'request' : 'reply'})`,
    start,
    28,
    [
      field(
        'Operation',
        request ? 'Request' : operation === 2 ? 'Reply' : String(operation),
        start + 6,
        2,
      ),
      field('Sender MAC Address', senderMac, start + 8, 6),
      field('Sender IP Address', senderIp, start + 14, 4),
      field('Target MAC Address', targetMac, start + 18, 6),
      field('Target IP Address', targetIp, start + 24, 4),
    ],
  );
  dissection.info = request
    ? `Who has ${targetIp}? Tell ${senderIp}`
    : `${senderIp} is at ${senderMac}`;
}

/**
 * Takes apart an IPv4 packet, then what it carries.
 * @param dissection The packet's dissection.
 * @param start The packet's first byte.
 */
function dissectIpv4(dissection: PacketDissection, start: number): void {
  const bytes: PacketBytes = dissection.bytes;
  if (!bytes.has(start, 20)) {
    dissection.cut();
    return;
  }
  const headerLength: number = ((bytes.u8(start) ?? 0) & 0x0f) * 4;
  const totalLength: number = bytes.u16(start + 2) ?? 0;
  const fragment: number = bytes.u16(start + 6) ?? 0;
  const ttl: number = bytes.u8(start + 8) ?? 0;
  const protocol: number = bytes.u8(start + 9) ?? 0;
  const source: string = formatIpv4(bytes.slice(start + 12, 4));
  const destination: string = formatIpv4(bytes.slice(start + 16, 4));
  // A packet's own length is what counts; anything after it is the link layer's padding.
  const end: number = Math.min(start + Math.max(totalLength, headerLength), bytes.length);
  dissection.add(
    'IPv4',
    `Internet Protocol Version 4, ${source} → ${destination}`,
    start,
    end - start,
    [
      field('Header Length', `${String(headerLength)} bytes`, start, 1),
      field('Total Length', String(totalLength), start + 2, 2),
      field(
        'Flags',
        (fragment & 0x4000) !== 0
          ? "Don't fragment"
          : (fragment & 0x2000) !== 0
            ? 'More fragments'
            : 'none',
        start + 6,
        2,
      ),
      field('Time to Live', String(ttl), start + 8, 1),
      field(
        'Protocol',
        `${IP_PROTOCOLS[protocol] ?? 'Unknown'} (${String(protocol)})`,
        start + 9,
        1,
      ),
      field('Source Address', source, start + 12, 4),
      field('Destination Address', destination, start + 16, 4),
    ],
  );
  dissection.source = source;
  dissection.destination = destination;
  dissection.destinationAddress = destination;
  if (headerLength < 20) {
    return;
  }
  if ((fragment & 0x1fff) !== 0) {
    // Only the first fragment carries the transport's header.
    dissection.info = `Fragmented IP protocol (${IP_PROTOCOLS[protocol] ?? String(protocol)})`;
    return;
  }
  if (IP_PROTOCOLS[protocol] !== undefined) {
    dissection.protocol = IP_PROTOCOLS[protocol];
  }
  dissectTransport(dissection, 4, protocol, start + headerLength, end);
}

/**
 * Takes apart an IPv6 packet, walking past its extension headers, then what it carries.
 * @param dissection The packet's dissection.
 * @param start The packet's first byte.
 */
function dissectIpv6(dissection: PacketDissection, start: number): void {
  const bytes: PacketBytes = dissection.bytes;
  if (!bytes.has(start, 40)) {
    dissection.cut();
    return;
  }
  const payloadLength: number = bytes.u16(start + 4) ?? 0;
  let next: number = bytes.u8(start + 6) ?? 0;
  const hopLimit: number = bytes.u8(start + 7) ?? 0;
  const source: string = formatIpv6(bytes.slice(start + 8, 16));
  const destination: string = formatIpv6(bytes.slice(start + 24, 16));
  const end: number = Math.min(start + 40 + payloadLength, bytes.length);
  dissection.add(
    'IPv6',
    `Internet Protocol Version 6, ${source} → ${destination}`,
    start,
    end - start,
    [
      field('Payload Length', String(payloadLength), start + 4, 2),
      field('Next Header', `${IP_PROTOCOLS[next] ?? 'Extension'} (${String(next)})`, start + 6, 1),
      field('Hop Limit', String(hopLimit), start + 7, 1),
      field('Source Address', source, start + 8, 16),
      field('Destination Address', destination, start + 24, 16),
    ],
  );
  dissection.source = source;
  dissection.destination = destination;
  dissection.destinationAddress = destination;
  let position: number = start + 40;
  for (let walked: number = 0; IPV6_EXTENSIONS.has(next) && walked < 8; walked += 1) {
    const header: number | undefined = bytes.u8(position);
    const length: number | undefined = bytes.u8(position + 1);
    if (header === undefined || length === undefined) {
      dissection.cut();
      return;
    }
    if (next === 44 && ((bytes.u16(position + 2) ?? 0) & 0xfff8) !== 0) {
      dissection.info = 'Fragmented IPv6 packet';
      return;
    }
    position += next === 44 ? 8 : (length + 1) * 8;
    next = header;
  }
  if (IP_PROTOCOLS[next] !== undefined) {
    dissection.protocol = IP_PROTOCOLS[next];
  }
  dissectTransport(dissection, 6, next, position, end);
}

/**
 * Takes apart what an EtherType says comes next.
 * @param dissection The packet's dissection.
 * @param etherType The EtherType.
 * @param start The payload's first byte.
 */
function dissectEtherPayload(dissection: PacketDissection, etherType: number, start: number): void {
  switch (etherType) {
    case 0x0800:
      dissectIpv4(dissection, start);
      return;
    case 0x86dd:
      dissectIpv6(dissection, start);
      return;
    case 0x0806:
      dissectArp(dissection, start);
      return;
    default:
      dissection.info = `EtherType 0x${etherType.toString(16).padStart(4, '0')}`;
  }
}

/**
 * Takes apart an Ethernet frame, and any 802.1Q VLAN tags, then what it carries.
 * @param dissection The packet's dissection.
 */
function dissectEthernet(dissection: PacketDissection): void {
  const bytes: PacketBytes = dissection.bytes;
  if (!bytes.has(0, 14)) {
    dissection.cut();
    return;
  }
  const destination: string = formatMac(bytes.slice(0, 6));
  const source: string = formatMac(bytes.slice(6, 6));
  let etherType: number = bytes.u16(12) ?? 0;
  let offset: number = 14;
  const fields: ReturnType<typeof field>[] = [
    field('Destination', destination, 0, 6),
    field('Source', source, 6, 6),
  ];
  while ((etherType === 0x8100 || etherType === 0x88a8) && bytes.has(offset, 4)) {
    fields.push(field('VLAN', String((bytes.u16(offset) ?? 0) & 0x0fff), offset, 2));
    etherType = bytes.u16(offset + 2) ?? 0;
    offset += 4;
  }
  fields.push(field('Type', `0x${etherType.toString(16).padStart(4, '0')}`, offset - 2, 2));
  dissection.add('Ethernet', `Ethernet II, ${source} → ${destination}`, 0, bytes.length, fields);
  dissection.source = source;
  dissection.destination = destination;
  dissectEtherPayload(dissection, etherType, offset);
}

/**
 * Takes apart a BSD loopback header — the address family, in host or network order — then the IP
 * packet it carries.
 * @param dissection The packet's dissection.
 * @param networkOrder Whether the family is in network byte order (`LOOP`) rather than the host's.
 */
function dissectLoopback(dissection: PacketDissection, networkOrder: boolean): void {
  const bytes: PacketBytes = dissection.bytes;
  const raw: number | undefined = bytes.u32(0, !networkOrder);
  if (raw === undefined) {
    dissection.cut();
    return;
  }
  // A capture made on a host of the other byte order puts the family in the high bytes.
  const family: number = raw > 0xffff ? (bytes.u32(0, networkOrder) ?? raw) : raw;
  dissection.add('Loopback', `Null/Loopback, family ${String(family)}`, 0, bytes.length, [
    field('Family', family === 2 ? 'IPv4' : 'IPv6', 0, 4),
  ]);
  if (family === 2) {
    dissectIpv4(dissection, 4);
  } else if (family === 24 || family === 28 || family === 30 || family === 10) {
    dissectIpv6(dissection, 4);
  } else {
    dissection.info = `Address family ${String(family)}`;
  }
}

/**
 * Takes apart a bare IP packet, by the version in its first nibble.
 * @param dissection The packet's dissection.
 * @param start The packet's first byte.
 */
function dissectRawIp(dissection: PacketDissection, start: number): void {
  const version: number | undefined = dissection.bytes.u8(start);
  if (version === undefined) {
    dissection.cut();
  } else if (version >> 4 === 4) {
    dissectIpv4(dissection, start);
  } else if (version >> 4 === 6) {
    dissectIpv6(dissection, start);
  }
}

/**
 * Takes a captured packet apart: each layer it recognises, outermost first, and a line summing it up.
 * Never throws: a packet cut short, malformed or of a protocol it does not know is dissected as far
 * as it goes.
 * @param linkType The capture's link-layer header type.
 * @param data The packet's captured bytes.
 * @returns Returns the dissected packet.
 */
export function dissectPacket(linkType: number, data: Uint8Array): DissectedPacket {
  return dissect(linkType, data).finish();
}

/**
 * Takes a captured packet apart, as {@link dissectPacket} does, keeping the dissection itself: what
 * it learned along the way that is not part of the packet's description, such as the host names the
 * packet names.
 * @param linkType The capture's link-layer header type.
 * @param data The packet's captured bytes.
 * @returns Returns the finished dissection.
 */
export function dissect(linkType: number, data: Uint8Array): PacketDissection {
  const dissection: PacketDissection = new PacketDissection(new PacketBytes(data));
  try {
    switch (linkType) {
      case LINKTYPE_ETHERNET:
        dissectEthernet(dissection);
        break;
      case LINKTYPE_NULL:
        dissectLoopback(dissection, false);
        break;
      case LINKTYPE_LOOP:
        dissectLoopback(dissection, true);
        break;
      case LINKTYPE_RAW:
      case 12:
      case 14:
        dissectRawIp(dissection, 0);
        break;
      case LINKTYPE_LINUX_SLL: {
        const etherType: number | undefined = dissection.bytes.u16(14);
        if (etherType === undefined) {
          dissection.cut();
        } else {
          dissection.add('SLL', 'Linux cooked capture', 0, data.length, [
            field('Protocol', `0x${etherType.toString(16).padStart(4, '0')}`, 14, 2),
          ]);
          dissectEtherPayload(dissection, etherType, 16);
        }
        break;
      }
      default:
        dissection.info = `Link type ${String(linkType)} is not dissected`;
    }
  } catch {
    // Every read is bounds-checked; this is the last line against a dissector's own mistake, so a
    // capture never stops over one packet.
    dissection.truncated = true;
  }
  return dissection;
}
