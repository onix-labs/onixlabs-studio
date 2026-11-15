/**
 * Builds packets byte by byte, for the packet specs and for sample captures: each function returns
 * the bytes of one layer wrapped around its payload, so a packet is built inside out.
 */

/**
 * Joins byte arrays.
 * @param parts The parts.
 * @returns Returns their bytes in order.
 */
export function bytesOf(...parts: readonly (Uint8Array | readonly number[])[]): Uint8Array {
  const total: number = parts.reduce(
    (sum: number, part: Uint8Array | readonly number[]): number => sum + part.length,
    0,
  );
  const joined: Uint8Array = new Uint8Array(total);
  let offset: number = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.length;
  }
  return joined;
}

/**
 * Writes a 16-bit number big-endian.
 * @param value The number.
 * @returns Returns its two bytes.
 */
export function u16(value: number): readonly number[] {
  return [(value >> 8) & 0xff, value & 0xff];
}

/**
 * Writes a 32-bit number big-endian.
 * @param value The number.
 * @returns Returns its four bytes.
 */
export function u32(value: number): readonly number[] {
  return [(value >>> 24) & 0xff, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

/**
 * Reads a dotted IPv4 address into bytes.
 * @param address The address.
 * @returns Returns its four bytes.
 */
export function ipv4Bytes(address: string): readonly number[] {
  return address.split('.').map(Number);
}

/**
 * Reads an IPv6 address — full or with one `::` — into bytes.
 * @param address The address.
 * @returns Returns its sixteen bytes.
 */
export function ipv6Bytes(address: string): readonly number[] {
  const [head, tail]: readonly string[] = address.includes('::')
    ? address.split('::')
    : [address, ''];
  const groups: (text: string) => number[] = (text: string): number[] =>
    text === '' ? [] : text.split(':').map((group: string): number => parseInt(group, 16));
  const front: number[] = groups(head);
  const back: number[] = groups(tail);
  const all: number[] = [
    ...front,
    ...new Array<number>(8 - front.length - back.length).fill(0),
    ...back,
  ];
  return all.flatMap((group: number): readonly number[] => u16(group));
}

/**
 * Wraps a payload in an Ethernet II frame.
 * @param source The source MAC, as bytes.
 * @param destination The destination MAC, as bytes.
 * @param etherType The EtherType.
 * @param payload The payload.
 * @returns Returns the frame.
 */
export function ethernet(
  source: readonly number[],
  destination: readonly number[],
  etherType: number,
  payload: Uint8Array,
): Uint8Array {
  return bytesOf(destination, source, u16(etherType), payload);
}

/**
 * Wraps a payload in an IPv4 header.
 * @param source The source address.
 * @param destination The destination address.
 * @param protocol The IP protocol number.
 * @param payload The payload.
 * @param ttl The time to live.
 * @returns Returns the packet.
 */
export function ipv4(
  source: string,
  destination: string,
  protocol: number,
  payload: Uint8Array,
  ttl: number = 64,
): Uint8Array {
  return bytesOf(
    [0x45, 0x00],
    u16(20 + payload.length),
    u16(0x1234),
    u16(0x4000),
    [ttl, protocol],
    u16(0),
    ipv4Bytes(source),
    ipv4Bytes(destination),
    payload,
  );
}

/**
 * Wraps a payload in an IPv6 header.
 * @param source The source address.
 * @param destination The destination address.
 * @param nextHeader The next header's protocol number.
 * @param payload The payload.
 * @returns Returns the packet.
 */
export function ipv6(
  source: string,
  destination: string,
  nextHeader: number,
  payload: Uint8Array,
): Uint8Array {
  return bytesOf(
    [0x60, 0, 0, 0],
    u16(payload.length),
    [nextHeader, 64],
    ipv6Bytes(source),
    ipv6Bytes(destination),
    payload,
  );
}

/**
 * Wraps a payload in a TCP header with no options.
 * @param sourcePort The source port.
 * @param destinationPort The destination port.
 * @param flags The flag bits.
 * @param payload The payload.
 * @param sequence The sequence number.
 * @param acknowledgement The acknowledgement number.
 * @returns Returns the segment.
 */
export function tcp(
  sourcePort: number,
  destinationPort: number,
  flags: number,
  payload: Uint8Array = new Uint8Array(0),
  sequence: number = 1000,
  acknowledgement: number = 0,
): Uint8Array {
  return bytesOf(
    u16(sourcePort),
    u16(destinationPort),
    u32(sequence),
    u32(acknowledgement),
    [0x50, flags],
    u16(65535),
    u16(0),
    u16(0),
    payload,
  );
}

/**
 * Wraps a payload in a UDP header.
 * @param sourcePort The source port.
 * @param destinationPort The destination port.
 * @param payload The payload.
 * @returns Returns the datagram.
 */
export function udp(sourcePort: number, destinationPort: number, payload: Uint8Array): Uint8Array {
  return bytesOf(u16(sourcePort), u16(destinationPort), u16(8 + payload.length), u16(0), payload);
}

/**
 * Writes a DNS name as labels.
 * @param name The dotted name.
 * @returns Returns its wire form.
 */
export function dnsName(name: string): readonly number[] {
  return [
    ...name
      .split('.')
      .flatMap((label: string): readonly number[] => [
        label.length,
        ...Array.from(label, (character: string): number => character.charCodeAt(0)),
      ]),
    0,
  ];
}

/**
 * Builds a DNS query for one name.
 * @param id The transaction id.
 * @param name The name.
 * @param type The record type.
 * @returns Returns the message.
 */
export function dnsQuery(id: number, name: string, type: number = 1): Uint8Array {
  return bytesOf(
    u16(id),
    u16(0x0100),
    u16(1),
    u16(0),
    u16(0),
    u16(0),
    dnsName(name),
    u16(type),
    u16(1),
  );
}

/**
 * Builds a DNS response answering one A query, the answer's name compressed to point at the
 * question's.
 * @param id The transaction id.
 * @param name The name.
 * @param address The answer's address.
 * @returns Returns the message.
 */
export function dnsResponse(id: number, name: string, address: string): Uint8Array {
  return bytesOf(
    u16(id),
    u16(0x8180),
    u16(1),
    u16(1),
    u16(0),
    u16(0),
    dnsName(name),
    u16(1),
    u16(1),
    [0xc0, 12],
    u16(1),
    u16(1),
    u32(300),
    u16(4),
    ipv4Bytes(address),
  );
}

/**
 * Builds a DNS response answering a query for a name through a chain of CNAMEs, ending in an address
 * record — A for an IPv4 address, AAAA for IPv6 — for the last name in the chain. Names are written in
 * full, uncompressed.
 * @param id The transaction id.
 * @param name The name asked for.
 * @param aliases The canonical names the chain passes through, in order; none for a direct answer.
 * @param address The answer's address.
 * @param replyCode The response code; 0 for no error.
 * @returns Returns the message.
 */
export function dnsAliasResponse(
  id: number,
  name: string,
  aliases: readonly string[],
  address: string,
  replyCode: number = 0,
): Uint8Array {
  const ipv6Address: boolean = address.includes(':');
  const chain: readonly string[] = [name, ...aliases];
  const cnames: readonly Uint8Array[] = aliases.map((alias: string, index: number): Uint8Array => {
    const target: readonly number[] = dnsName(alias);
    return bytesOf(dnsName(chain[index]), u16(5), u16(1), u32(300), u16(target.length), target);
  });
  const data: readonly number[] = ipv6Address ? ipv6Bytes(address) : ipv4Bytes(address);
  const record: Uint8Array = bytesOf(
    dnsName(chain[chain.length - 1]),
    u16(ipv6Address ? 28 : 1),
    u16(1),
    u32(60),
    u16(data.length),
    data,
  );
  return bytesOf(
    u16(id),
    u16(0x8180 | replyCode),
    u16(1),
    u16(aliases.length + 1),
    u16(0),
    u16(0),
    dnsName(name),
    u16(ipv6Address ? 28 : 1),
    u16(1),
    ...cnames,
    record,
  );
}

/**
 * Builds a TLS record carrying a Client Hello that asks for a server by name and offers protocols.
 * @param serverName The server name.
 * @param protocols The application protocols offered.
 * @returns Returns the record.
 */
export function tlsClientHello(
  serverName: string,
  protocols: readonly string[] = ['h2', 'http/1.1'],
): Uint8Array {
  const name: readonly number[] = Array.from(serverName, (c: string): number => c.charCodeAt(0));
  const sni: Uint8Array = bytesOf(
    u16(0),
    u16(name.length + 5),
    u16(name.length + 3),
    [0],
    u16(name.length),
    name,
  );
  const alpnList: Uint8Array = bytesOf(
    ...protocols.map((protocol: string): readonly number[] => [
      protocol.length,
      ...Array.from(protocol, (c: string): number => c.charCodeAt(0)),
    ]),
  );
  const alpn: Uint8Array = bytesOf(
    u16(16),
    u16(alpnList.length + 2),
    u16(alpnList.length),
    alpnList,
  );
  const extensions: Uint8Array = bytesOf(sni, alpn);
  const body: Uint8Array = bytesOf(
    u16(0x0303),
    new Uint8Array(32),
    [0],
    u16(2),
    u16(0x1301),
    [1, 0],
    u16(extensions.length),
    extensions,
  );
  const handshake: Uint8Array = bytesOf(
    [1],
    [0, (body.length >> 8) & 0xff, body.length & 0xff],
    body,
  );
  return bytesOf([22], u16(0x0301), u16(handshake.length), handshake);
}

/**
 * Builds an ARP request asking who has an address.
 * @param senderMac The asker's MAC, as bytes.
 * @param senderIp The asker's address.
 * @param targetIp The address asked about.
 * @returns Returns the message.
 */
export function arpRequest(
  senderMac: readonly number[],
  senderIp: string,
  targetIp: string,
): Uint8Array {
  return bytesOf(
    u16(1),
    u16(0x0800),
    [6, 4],
    u16(1),
    senderMac,
    ipv4Bytes(senderIp),
    [0, 0, 0, 0, 0, 0],
    ipv4Bytes(targetIp),
  );
}

/**
 * Builds an ICMP echo request.
 * @param id The identifier.
 * @param sequence The sequence number.
 * @returns Returns the message.
 */
export function icmpEcho(id: number, sequence: number): Uint8Array {
  return bytesOf([8, 0], u16(0), u16(id), u16(sequence), new Uint8Array(8));
}

/**
 * A Mac's Wi-Fi MAC address, for samples.
 */
export const hostMac: readonly number[] = [0x3c, 0x22, 0xfb, 0x12, 0x34, 0x56];

/**
 * A home router's MAC address, for samples.
 */
export const routerMac: readonly number[] = [0xa4, 0x91, 0xb1, 0x00, 0x00, 0x01];
