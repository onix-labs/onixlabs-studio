import { PacketField } from './packet-model';
import { formatIpv4, formatIpv6, PacketBytes } from './packet-bytes';
import { field, PacketDissection } from './packet-dissection';

/**
 * The ports DNS's wire format is spoken on: DNS itself, multicast DNS and LLMNR.
 */
const DNS_PORTS: ReadonlySet<number> = new Set<number>([53, 5353, 5355]);

/**
 * Names the DNS record types worth naming.
 */
const DNS_TYPES: Readonly<Record<number, string>> = {
  1: 'A',
  2: 'NS',
  5: 'CNAME',
  6: 'SOA',
  12: 'PTR',
  15: 'MX',
  16: 'TXT',
  28: 'AAAA',
  33: 'SRV',
  41: 'OPT',
  64: 'SVCB',
  65: 'HTTPS',
  255: 'ANY',
};

/**
 * Names DNS's response codes.
 */
const DNS_RCODES: Readonly<Record<number, string>> = {
  0: 'No error',
  1: 'Format error',
  2: 'Server failure',
  3: 'No such name',
  4: 'Not implemented',
  5: 'Refused',
};

/**
 * Names TLS's record content types.
 */
const TLS_CONTENT: Readonly<Record<number, string>> = {
  20: 'Change Cipher Spec',
  21: 'Alert',
  22: 'Handshake',
  23: 'Application Data',
};

/**
 * Names TLS's handshake messages.
 */
const TLS_HANDSHAKES: Readonly<Record<number, string>> = {
  1: 'Client Hello',
  2: 'Server Hello',
  4: 'New Session Ticket',
  8: 'Encrypted Extensions',
  11: 'Certificate',
  12: 'Server Key Exchange',
  13: 'Certificate Request',
  14: 'Server Hello Done',
  15: 'Certificate Verify',
  16: 'Client Key Exchange',
  20: 'Finished',
};

/**
 * Names TLS's protocol versions, as a record or hello carries them.
 */
const TLS_VERSIONS: Readonly<Record<number, string>> = {
  0x0301: 'TLS 1.0',
  0x0302: 'TLS 1.1',
  0x0303: 'TLS 1.2',
  0x0304: 'TLS 1.3',
};

/**
 * Matches the first line of an HTTP/1 request or response.
 */
const HTTP_START: RegExp =
  /^(?:(?:GET|POST|PUT|DELETE|HEAD|OPTIONS|PATCH|CONNECT|TRACE) \S+ HTTP\/1\.[01]|HTTP\/1\.[01] \d{3})/;

/**
 * Describes a DNS name read from a message.
 */
interface DnsName {
  /**
   * Gets the name, dotted; `<Root>` for the root.
   */
  readonly name: string;

  /**
   * Gets the byte after the name where it was written, which compression makes shorter than the name.
   */
  readonly next: number;
}

/**
 * Names a DNS record type.
 * @param type The type's number.
 * @returns Returns its mnemonic, or `TYPE<n>`.
 */
function dnsType(type: number): string {
  return DNS_TYPES[type] ?? `TYPE${String(type)}`;
}

/**
 * Reads a DNS name, following compression pointers within the message.
 * @param bytes The packet.
 * @param message The message's first byte, which pointers count from.
 * @param offset The name's first byte.
 * @returns Returns the name, or undefined when it runs off the packet or loops.
 */
function readDnsName(bytes: PacketBytes, message: number, offset: number): DnsName | undefined {
  const labels: string[] = [];
  let position: number = offset;
  let next: number | undefined;
  for (let jumps: number = 0; jumps < 32;) {
    const length: number | undefined = bytes.u8(position);
    if (length === undefined) {
      return undefined;
    }
    if (length === 0) {
      return {
        name: labels.length === 0 ? '<Root>' : labels.join('.'),
        next: next ?? position + 1,
      };
    }
    if ((length & 0xc0) === 0xc0) {
      const low: number | undefined = bytes.u8(position + 1);
      if (low === undefined) {
        return undefined;
      }
      next ??= position + 2;
      position = message + (((length & 0x3f) << 8) | low);
      jumps += 1;
      continue;
    }
    if (!bytes.has(position + 1, length) || labels.length > 127) {
      return undefined;
    }
    labels.push(bytes.ascii(position + 1, length));
    position += 1 + length;
  }
  return undefined;
}

/**
 * Takes apart a DNS message.
 * @param dissection The packet's dissection.
 * @param start The message's first byte.
 * @param end The byte after the message.
 * @returns Returns true when the message was recognised.
 */
function dissectDns(dissection: PacketDissection, start: number, end: number): boolean {
  const bytes: PacketBytes = dissection.bytes;
  if (!bytes.has(start, 12) || end - start < 12) {
    return false;
  }
  const id: number = bytes.u16(start) ?? 0;
  const flags: number = bytes.u16(start + 2) ?? 0;
  const questions: number = bytes.u16(start + 4) ?? 0;
  const answers: number = bytes.u16(start + 6) ?? 0;
  const response: boolean = (flags & 0x8000) !== 0;
  const rcode: number = flags & 0x000f;
  const fields: PacketField[] = [
    field('Transaction ID', `0x${id.toString(16).padStart(4, '0')}`, start, 2),
    field('Message', response ? 'Response' : 'Query', start + 2, 2),
    ...(response ? [field('Reply Code', DNS_RCODES[rcode] ?? String(rcode), start + 3, 1)] : []),
    field('Questions', String(questions), start + 4, 2),
    field('Answers', String(answers), start + 6, 2),
  ];
  let position: number = start + 12;
  const asked: string[] = [];
  for (let index: number = 0; index < Math.min(questions, 16); index += 1) {
    const name: DnsName | undefined = readDnsName(bytes, start, position);
    const type: number | undefined = name === undefined ? undefined : bytes.u16(name.next);
    if (name === undefined || type === undefined) {
      dissection.cut();
      break;
    }
    asked.push(`${dnsType(type)} ${name.name}`);
    fields.push(
      field('Query', `${name.name}: type ${dnsType(type)}`, position, name.next + 4 - position),
    );
    position = name.next + 4;
  }
  const answered: string[] = [];
  for (let index: number = 0; index < Math.min(answers, 32); index += 1) {
    const name: DnsName | undefined = readDnsName(bytes, start, position);
    const type: number | undefined = name === undefined ? undefined : bytes.u16(name.next);
    const dataLength: number | undefined =
      name === undefined ? undefined : bytes.u16(name.next + 8);
    if (name === undefined || type === undefined || dataLength === undefined) {
      dissection.cut();
      break;
    }
    const data: number = name.next + 10;
    let value: string = `${String(dataLength)} bytes`;
    if (type === 1 && dataLength === 4 && bytes.has(data, 4)) {
      value = formatIpv4(bytes.slice(data, 4));
    } else if (type === 28 && dataLength === 16 && bytes.has(data, 16)) {
      value = formatIpv6(bytes.slice(data, 16));
    } else if (type === 5 || type === 12 || type === 2) {
      value = readDnsName(bytes, start, data)?.name ?? value;
    }
    answered.push(`${dnsType(type)} ${value}`);
    fields.push(
      field(
        'Answer',
        `${name.name}: type ${dnsType(type)}, ${value}`,
        position,
        data + dataLength - position,
      ),
    );
    position = data + dataLength;
  }
  const kind: string = response ? 'Standard query response' : 'Standard query';
  const failure: string = response && rcode !== 0 ? ` ${DNS_RCODES[rcode] ?? String(rcode)}` : '';
  dissection.add(
    'DNS',
    `Domain Name System (${response ? 'response' : 'query'})`,
    start,
    end - start,
    fields,
  );
  dissection.info = `${kind} 0x${id.toString(16).padStart(4, '0')}${failure} ${asked.join(', ')}${
    answered.length === 0 ? '' : ` ${answered.join(' ')}`
  }`.trim();
  return true;
}

/**
 * Takes apart the extensions of a TLS hello, for the server name and the application protocols.
 * @param bytes The packet.
 * @param offset The extensions' length field.
 * @param fields Receives a field per extension worth showing.
 * @returns Returns the server name a Client Hello asked for, if it did.
 */
function readTlsExtensions(
  bytes: PacketBytes,
  offset: number,
  fields: PacketField[],
): string | undefined {
  const total: number | undefined = bytes.u16(offset);
  if (total === undefined) {
    return undefined;
  }
  let serverName: string | undefined;
  let position: number = offset + 2;
  const end: number = Math.min(position + total, bytes.length);
  while (position + 4 <= end) {
    const type: number = bytes.u16(position) ?? 0;
    const length: number = bytes.u16(position + 2) ?? 0;
    const data: number = position + 4;
    if (type === 0) {
      const nameLength: number | undefined = bytes.u16(data + 3);
      if (nameLength !== undefined && bytes.has(data + 5, nameLength)) {
        serverName = bytes.ascii(data + 5, nameLength);
        fields.push(field('Server Name', serverName, data + 5, nameLength));
      }
    } else if (type === 16) {
      const protocols: string[] = [];
      let entry: number = data + 2;
      while (entry < data + length) {
        const entryLength: number = bytes.u8(entry) ?? 0;
        if (entryLength === 0 || !bytes.has(entry + 1, entryLength)) {
          break;
        }
        protocols.push(bytes.ascii(entry + 1, entryLength));
        entry += 1 + entryLength;
      }
      fields.push(field('Application Protocols', protocols.join(', '), data, length));
    }
    position = data + length;
  }
  return serverName;
}

/**
 * Takes apart the first TLS record in a segment: its type and version, and for a hello the server
 * name and protocols it names. Everything after the handshake is encrypted, so is only named.
 * @param dissection The packet's dissection.
 * @param start The record's first byte.
 * @param end The byte after the segment.
 * @returns Returns true when the segment starts a TLS record.
 */
function dissectTls(dissection: PacketDissection, start: number, end: number): boolean {
  const bytes: PacketBytes = dissection.bytes;
  const type: number | undefined = bytes.u8(start);
  const version: number | undefined = bytes.u16(start + 1);
  const length: number | undefined = bytes.u16(start + 3);
  if (
    type === undefined ||
    version === undefined ||
    length === undefined ||
    TLS_CONTENT[type] === undefined ||
    (version & 0xff00) !== 0x0300
  ) {
    return false;
  }
  const fields: PacketField[] = [
    field('Content Type', TLS_CONTENT[type], start, 1),
    field('Version', TLS_VERSIONS[version] ?? `0x${version.toString(16)}`, start + 1, 2),
    field('Length', String(length), start + 3, 2),
  ];
  let info: string = TLS_CONTENT[type];
  if (type === 22) {
    const message: number | undefined = bytes.u8(start + 5);
    const name: string | undefined = message === undefined ? undefined : TLS_HANDSHAKES[message];
    if (name !== undefined && message !== undefined) {
      fields.push(field('Handshake', name, start + 5, 1));
      info = name;
      if (message === 1 || message === 2) {
        // Past the handshake header, the legacy version and the 32-byte random.
        const sessionId: number = start + 5 + 4 + 2 + 32;
        const sessionLength: number = bytes.u8(sessionId) ?? 0;
        let next: number = sessionId + 1 + sessionLength;
        if (message === 1) {
          next += 2 + (bytes.u16(next) ?? 0);
          next += 1 + (bytes.u8(next) ?? 0);
        } else {
          next += 3;
        }
        const serverName: string | undefined = readTlsExtensions(bytes, next, fields);
        if (serverName !== undefined) {
          info = `${name} (${serverName})`;
        }
      }
    } else {
      // A handshake message after the keys are agreed is itself encrypted.
      info = 'Encrypted Handshake Message';
    }
  }
  dissection.add('TLS', `Transport Layer Security: ${info}`, start, end - start, fields);
  dissection.info = info;
  return true;
}

/**
 * Takes apart an HTTP/1 message's first line.
 * @param dissection The packet's dissection.
 * @param start The message's first byte.
 * @param end The byte after the segment.
 * @returns Returns true when the segment starts an HTTP/1 request or response.
 */
function dissectHttp(dissection: PacketDissection, start: number, end: number): boolean {
  const head: string = dissection.bytes.ascii(start, Math.min(end - start, 256));
  if (!HTTP_START.test(head)) {
    return false;
  }
  const line: string = head.split('\r\n')[0];
  dissection.add('HTTP', `Hypertext Transfer Protocol: ${line}`, start, end - start, [
    field(line.startsWith('HTTP/') ? 'Status Line' : 'Request Line', line, start, line.length),
  ]);
  dissection.info = line;
  return true;
}

/**
 * Takes apart what a TCP segment or UDP datagram carries, where it is a protocol worth reading: DNS,
 * TLS's handshake, or HTTP/1's first line.
 * @param dissection The packet's dissection.
 * @param transport The transport that carried it.
 * @param start The payload's first byte.
 * @param end The byte after the payload.
 * @param ports The source and destination ports.
 */
export function dissectApplication(
  dissection: PacketDissection,
  transport: 'TCP' | 'UDP',
  start: number,
  end: number,
  ports: readonly [number, number],
): void {
  if (end <= start) {
    return;
  }
  const dns: boolean = DNS_PORTS.has(ports[0]) || DNS_PORTS.has(ports[1]);
  if (dns) {
    // Over TCP, a DNS message is preceded by its length.
    dissectDns(dissection, transport === 'TCP' ? start + 2 : start, end);
    return;
  }
  if (transport === 'TCP' && !dissectTls(dissection, start, end)) {
    dissectHttp(dissection, start, end);
  }
}
