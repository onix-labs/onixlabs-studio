/**
 * Reads big-endian (network order) numbers from a packet without ever reading past its end: a packet
 * cut short by the capture's snapshot length is the normal case, not an error, so every read says
 * whether the bytes were there.
 */
export class PacketBytes {
  /**
   * Holds a view over the packet.
   */
  private readonly view: DataView;

  /**
   * Creates a reader over a packet.
   * @param data The packet's bytes.
   */
  public constructor(public readonly data: Uint8Array) {
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }

  /**
   * Gets the packet's length.
   * @returns Returns the number of bytes captured.
   */
  public get length(): number {
    return this.data.length;
  }

  /**
   * Gets whether a span lies wholly within the packet.
   * @param offset The span's first byte.
   * @param length The span's length.
   * @returns Returns true when every byte of it was captured.
   */
  public has(offset: number, length: number): boolean {
    return offset >= 0 && length >= 0 && offset + length <= this.data.length;
  }

  /**
   * Reads an unsigned byte.
   * @param offset Where.
   * @returns Returns it, or undefined past the end.
   */
  public u8(offset: number): number | undefined {
    return this.has(offset, 1) ? this.view.getUint8(offset) : undefined;
  }

  /**
   * Reads an unsigned 16-bit number.
   * @param offset Where.
   * @returns Returns it, or undefined past the end.
   */
  public u16(offset: number): number | undefined {
    return this.has(offset, 2) ? this.view.getUint16(offset, false) : undefined;
  }

  /**
   * Reads an unsigned 32-bit number.
   * @param offset Where.
   * @param littleEndian Whether it is little-endian, as a loopback header's family is on most hosts.
   * @returns Returns it, or undefined past the end.
   */
  public u32(offset: number, littleEndian: boolean = false): number | undefined {
    return this.has(offset, 4) ? this.view.getUint32(offset, littleEndian) : undefined;
  }

  /**
   * Copies a span, clipped to the packet's end.
   * @param offset The span's first byte.
   * @param length The span's length.
   * @returns Returns the bytes that were captured of it.
   */
  public slice(offset: number, length: number): Uint8Array {
    return this.data.subarray(Math.max(0, offset), Math.min(this.data.length, offset + length));
  }

  /**
   * Reads a span as ASCII text, for the printable protocols' first lines.
   * @param offset The span's first byte.
   * @param length The span's length.
   * @returns Returns the text.
   */
  public ascii(offset: number, length: number): string {
    return String.fromCharCode(...this.slice(offset, length));
  }
}

/**
 * Formats bytes as colon-separated hex: a MAC address.
 * @param bytes The bytes.
 * @returns Returns them as `aa:bb:cc:dd:ee:ff`.
 */
export function formatMac(bytes: Uint8Array): string {
  return Array.from(bytes, (byte: number): string => byte.toString(16).padStart(2, '0')).join(':');
}

/**
 * Formats four bytes as an IPv4 address.
 * @param bytes The bytes.
 * @returns Returns the dotted address.
 */
export function formatIpv4(bytes: Uint8Array): string {
  return Array.from(bytes, (byte: number): string => String(byte)).join('.');
}

/**
 * Formats sixteen bytes as an IPv6 address in its canonical text form (RFC 5952): lower-case hex,
 * no leading zeros, and the longest run of two or more zero groups — the first, on a tie — written as
 * `::`.
 * @param bytes The bytes.
 * @returns Returns the address.
 */
export function formatIpv6(bytes: Uint8Array): string {
  const groups: number[] = [];
  for (let index: number = 0; index + 1 < bytes.length && groups.length < 8; index += 2) {
    groups.push((bytes[index] << 8) | bytes[index + 1]);
  }
  let bestStart: number = -1;
  let bestLength: number = 0;
  for (let index: number = 0; index < groups.length;) {
    if (groups[index] !== 0) {
      index += 1;
      continue;
    }
    let end: number = index;
    while (end < groups.length && groups[end] === 0) {
      end += 1;
    }
    if (end - index > bestLength) {
      bestStart = index;
      bestLength = end - index;
    }
    index = end;
  }
  const text: (values: readonly number[]) => string = (values: readonly number[]): string =>
    values.map((group: number): string => group.toString(16)).join(':');
  if (bestLength < 2) {
    return text(groups);
  }
  return `${text(groups.slice(0, bestStart))}::${text(groups.slice(bestStart + bestLength))}`;
}

/**
 * Formats bytes as a run of hex pairs, for fields shown raw.
 * @param bytes The bytes.
 * @returns Returns them as `0x1a2b…`.
 */
export function formatHex(bytes: Uint8Array): string {
  return `0x${Array.from(bytes, (byte: number): string => byte.toString(16).padStart(2, '0')).join('')}`;
}
