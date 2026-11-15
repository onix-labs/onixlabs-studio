import { PcapRecord } from './packet-model';

/**
 * The length of a pcap file's global header.
 */
const GLOBAL_HEADER_LENGTH: number = 24;

/**
 * The length of each record's header.
 */
const RECORD_HEADER_LENGTH: number = 16;

/**
 * The largest record this reader accepts. libpcap's own ceiling is 256 KiB; anything bigger means the
 * stream is not what it claims, and reading on would only buffer garbage.
 */
const MAX_RECORD_LENGTH: number = 256 * 1024;

/**
 * Thrown when a stream is not a pcap capture, or stops being one part-way.
 */
export class PcapFormatError extends Error {
  /**
   * Gets the error's name.
   */
  public override readonly name: string = 'PcapFormatError';
}

/**
 * Reads the classic pcap format — what `tcpdump -w` writes — from a stream that arrives in chunks of
 * any size: a record split across two chunks is held until the rest arrives.
 *
 * pcapng is not read: `tcpdump` writes pcap unless asked otherwise, and so does every capture this
 * explorer starts.
 */
export class PcapStreamReader {
  /**
   * Holds bytes received but not yet read, because they end part-way through a header or record.
   */
  private pending: Uint8Array = new Uint8Array(0);

  /**
   * Holds whether the capture's numbers are little-endian, once the global header has been read.
   */
  private littleEndian: boolean | undefined;

  /**
   * Holds whether timestamps' fractions are nanoseconds rather than microseconds.
   */
  private nanoseconds: boolean = false;

  /**
   * Gets the capture's link-layer header type, once the global header has been read.
   */
  public linkType: number | undefined;

  /**
   * Gets the capture's snapshot length, the most bytes of any packet it records.
   */
  public snapshotLength: number | undefined;

  /**
   * Reads a chunk of the stream.
   * @param chunk The chunk.
   * @returns Returns the records the chunk completed, in order.
   * @throws PcapFormatError when the stream is not a pcap capture.
   */
  public push(chunk: Uint8Array): PcapRecord[] {
    this.pending = concat(this.pending, chunk);
    let offset: number = 0;
    if (this.littleEndian === undefined) {
      if (this.pending.length < GLOBAL_HEADER_LENGTH) {
        return [];
      }
      this.readGlobalHeader(new DataView(this.pending.buffer, this.pending.byteOffset));
      offset = GLOBAL_HEADER_LENGTH;
    }
    const records: PcapRecord[] = [];
    const view: DataView = new DataView(this.pending.buffer, this.pending.byteOffset);
    const little: boolean = this.littleEndian ?? true;
    while (this.pending.length - offset >= RECORD_HEADER_LENGTH) {
      const seconds: number = view.getUint32(offset, little);
      const fraction: number = view.getUint32(offset + 4, little);
      const capturedLength: number = view.getUint32(offset + 8, little);
      const originalLength: number = view.getUint32(offset + 12, little);
      if (capturedLength > MAX_RECORD_LENGTH) {
        throw new PcapFormatError(`A record claims ${String(capturedLength)} bytes`);
      }
      if (this.pending.length - offset - RECORD_HEADER_LENGTH < capturedLength) {
        break;
      }
      const start: number = offset + RECORD_HEADER_LENGTH;
      records.push({
        timestampMs: seconds * 1000 + (this.nanoseconds ? fraction / 1e6 : fraction / 1e3),
        originalLength,
        // Copied, so a record outlives the buffer it arrived in.
        data: this.pending.slice(start, start + capturedLength),
      });
      offset = start + capturedLength;
    }
    this.pending = this.pending.slice(offset);
    return records;
  }

  /**
   * Gets how many bytes are held waiting for the rest of a record.
   * @returns Returns the count.
   */
  public get buffered(): number {
    return this.pending.length;
  }

  /**
   * Reads the global header: the magic number that says the byte order and timestamp resolution, and
   * the link type.
   * @param view The stream's first bytes.
   * @throws PcapFormatError when the magic number is not a pcap one.
   */
  private readGlobalHeader(view: DataView): void {
    const magic: number = view.getUint32(0, false);
    switch (magic) {
      case 0xa1b2c3d4:
        this.littleEndian = false;
        break;
      case 0xd4c3b2a1:
        this.littleEndian = true;
        break;
      case 0xa1b23c4d:
        this.littleEndian = false;
        this.nanoseconds = true;
        break;
      case 0x4d3cb2a1:
        this.littleEndian = true;
        this.nanoseconds = true;
        break;
      case 0x0a0d0d0a:
        throw new PcapFormatError('The capture is pcapng, which is not read yet');
      default:
        throw new PcapFormatError('The stream is not a pcap capture');
    }
    this.snapshotLength = view.getUint32(16, this.littleEndian);
    // The top bits of the link type field carry FCS flags in newer files.
    this.linkType = view.getUint32(20, this.littleEndian) & 0x0fffffff;
  }
}

/**
 * Joins two byte arrays.
 * @param first The first.
 * @param second The second.
 * @returns Returns their bytes in order, reusing the second when the first is empty.
 */
function concat(first: Uint8Array, second: Uint8Array): Uint8Array {
  if (first.length === 0) {
    return second;
  }
  const joined: Uint8Array = new Uint8Array(first.length + second.length);
  joined.set(first, 0);
  joined.set(second, first.length);
  return joined;
}
