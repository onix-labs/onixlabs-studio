import { PacketField } from './packet-model';
import { PacketBytes } from './packet-bytes';
import { dissectApplication } from './dissect-application';
import { field, PacketDissection } from './packet-dissection';

/**
 * Names ICMP's message types.
 */
const ICMP_TYPES: Readonly<Record<number, string>> = {
  0: 'Echo (ping) reply',
  3: 'Destination unreachable',
  5: 'Redirect',
  8: 'Echo (ping) request',
  11: 'Time-to-live exceeded',
};

/**
 * Names ICMPv6's message types.
 */
const ICMPV6_TYPES: Readonly<Record<number, string>> = {
  1: 'Destination unreachable',
  2: 'Packet too big',
  3: 'Time exceeded',
  128: 'Echo (ping) request',
  129: 'Echo (ping) reply',
  133: 'Router solicitation',
  134: 'Router advertisement',
  135: 'Neighbor solicitation',
  136: 'Neighbor advertisement',
};

/**
 * TCP's flags, lowest bit first, as packet tools conventionally list them: a handshake's reply reads
 * `[SYN, ACK]`, a push `[PSH, ACK]`.
 */
const TCP_FLAGS: readonly (readonly [number, string])[] = [
  [0x01, 'FIN'],
  [0x02, 'SYN'],
  [0x04, 'RST'],
  [0x08, 'PSH'],
  [0x10, 'ACK'],
  [0x20, 'URG'],
  [0x40, 'ECE'],
  [0x80, 'CWR'],
];

/**
 * Adds a port to an address, bracketing an IPv6 address so the port stands apart.
 * @param address The address.
 * @param port The port.
 * @returns Returns the endpoint.
 */
function endpoint(address: string, port: number): string {
  return `${address.includes(':') ? `[${address}]` : address}:${String(port)}`;
}

/**
 * Takes apart a TCP segment, then what it carries.
 * @param dissection The packet's dissection.
 * @param start The segment's first byte.
 * @param end The byte after it.
 */
function dissectTcp(dissection: PacketDissection, start: number, end: number): void {
  const bytes: PacketBytes = dissection.bytes;
  if (!bytes.has(start, 20)) {
    dissection.cut();
    return;
  }
  const sourcePort: number = bytes.u16(start) ?? 0;
  const destinationPort: number = bytes.u16(start + 2) ?? 0;
  const sequence: number = bytes.u32(start + 4) ?? 0;
  const acknowledgement: number = bytes.u32(start + 8) ?? 0;
  const headerLength: number = ((bytes.u8(start + 12) ?? 0) >> 4) * 4;
  const flagBits: number = bytes.u8(start + 13) ?? 0;
  const window: number = bytes.u16(start + 14) ?? 0;
  const flags: readonly string[] = TCP_FLAGS.filter(
    ([bit]: readonly [number, string]): boolean => (flagBits & bit) !== 0,
  ).map(([, name]: readonly [number, string]): string => name);
  const payload: number = Math.max(0, end - start - headerLength);
  const fields: readonly PacketField[] = [
    field('Source Port', String(sourcePort), start, 2),
    field('Destination Port', String(destinationPort), start + 2, 2),
    field('Sequence Number', String(sequence), start + 4, 4),
    field('Acknowledgement Number', String(acknowledgement), start + 8, 4),
    field('Header Length', `${String(headerLength)} bytes`, start + 12, 1),
    field('Flags', flags.join(', ') || 'none', start + 13, 1),
    field('Window', String(window), start + 14, 2),
    field('Payload', `${String(payload)} bytes`, start + headerLength, payload),
  ];
  dissection.add(
    'TCP',
    `Transmission Control Protocol, ${String(sourcePort)} → ${String(destinationPort)}, Len: ${String(payload)}`,
    start,
    end - start,
    fields,
  );
  dissection.source = endpoint(dissection.source, sourcePort);
  dissection.destination = endpoint(dissection.destination, destinationPort);
  dissection.info =
    `${String(sourcePort)} → ${String(destinationPort)} [${flags.join(', ')}] ` +
    `Seq=${String(sequence)}${(flagBits & 0x10) !== 0 ? ` Ack=${String(acknowledgement)}` : ''} ` +
    `Win=${String(window)} Len=${String(payload)}`;
  if (headerLength >= 20 && payload > 0) {
    dissectApplication(dissection, 'TCP', start + headerLength, end, [sourcePort, destinationPort]);
  }
}

/**
 * Takes apart a UDP datagram, then what it carries.
 * @param dissection The packet's dissection.
 * @param start The datagram's first byte.
 * @param end The byte after it.
 */
function dissectUdp(dissection: PacketDissection, start: number, end: number): void {
  const bytes: PacketBytes = dissection.bytes;
  if (!bytes.has(start, 8)) {
    dissection.cut();
    return;
  }
  const sourcePort: number = bytes.u16(start) ?? 0;
  const destinationPort: number = bytes.u16(start + 2) ?? 0;
  const length: number = bytes.u16(start + 4) ?? 0;
  dissection.add(
    'UDP',
    `User Datagram Protocol, ${String(sourcePort)} → ${String(destinationPort)}`,
    start,
    end - start,
    [
      field('Source Port', String(sourcePort), start, 2),
      field('Destination Port', String(destinationPort), start + 2, 2),
      field('Length', String(length), start + 4, 2),
    ],
  );
  dissection.source = endpoint(dissection.source, sourcePort);
  dissection.destination = endpoint(dissection.destination, destinationPort);
  dissection.info = `${String(sourcePort)} → ${String(destinationPort)} Len=${String(Math.max(0, length - 8))}`;
  dissectApplication(dissection, 'UDP', start + 8, Math.min(end, start + length), [
    sourcePort,
    destinationPort,
  ]);
}

/**
 * Takes apart an ICMP or ICMPv6 message: its type, and an echo's identifier and sequence.
 * @param dissection The packet's dissection.
 * @param version 4 for ICMP, 6 for ICMPv6.
 * @param start The message's first byte.
 * @param end The byte after it.
 */
function dissectIcmp(
  dissection: PacketDissection,
  version: 4 | 6,
  start: number,
  end: number,
): void {
  const bytes: PacketBytes = dissection.bytes;
  const type: number | undefined = bytes.u8(start);
  const code: number | undefined = bytes.u8(start + 1);
  if (type === undefined || code === undefined) {
    dissection.cut();
    return;
  }
  const names: Readonly<Record<number, string>> = version === 4 ? ICMP_TYPES : ICMPV6_TYPES;
  const name: string = names[type] ?? `Type ${String(type)}`;
  const echo: boolean = version === 4 ? type === 0 || type === 8 : type === 128 || type === 129;
  const fields: PacketField[] = [
    field('Type', `${String(type)} (${name})`, start, 1),
    field('Code', String(code), start + 1, 1),
  ];
  let info: string = name;
  if (echo && bytes.has(start + 4, 4)) {
    const id: number = bytes.u16(start + 4) ?? 0;
    const sequence: number = bytes.u16(start + 6) ?? 0;
    fields.push(field('Identifier', `0x${id.toString(16).padStart(4, '0')}`, start + 4, 2));
    fields.push(field('Sequence Number', String(sequence), start + 6, 2));
    info = `${name} id=0x${id.toString(16).padStart(4, '0')}, seq=${String(sequence)}`;
  }
  const protocol: string = version === 4 ? 'ICMP' : 'ICMPv6';
  dissection.add(protocol, `${protocol}: ${name}`, start, end - start, fields);
  dissection.info = info;
}

/**
 * Takes apart what an IP packet carries, by its protocol number.
 * @param dissection The packet's dissection.
 * @param version The IP version that carried it.
 * @param protocol The IP protocol number.
 * @param start The payload's first byte.
 * @param end The byte after it.
 */
export function dissectTransport(
  dissection: PacketDissection,
  version: 4 | 6,
  protocol: number,
  start: number,
  end: number,
): void {
  switch (protocol) {
    case 6:
      dissectTcp(dissection, start, end);
      return;
    case 17:
      dissectUdp(dissection, start, end);
      return;
    case 1:
      dissectIcmp(dissection, 4, start, end);
      return;
    case 58:
      dissectIcmp(dissection, 6, start, end);
      return;
    default:
      dissection.info = `IP protocol ${String(protocol)}`;
  }
}
