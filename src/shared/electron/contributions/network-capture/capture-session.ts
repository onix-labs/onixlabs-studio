import { copyFile, open, truncate } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { CapturedPacket, CapturedPacketRow } from '@shared/api/network-capture-channels';
import { dissect } from '@shared/api/packets/dissect-packet';
import { HostNameSighting, PcapRecord } from '@shared/api/packets/packet-model';
import { PacketDissection } from '@shared/api/packets/packet-dissection';
import { PcapStreamReader } from '@shared/api/packets/pcap-reader';

/**
 * Where one packet's bytes are in the capture's file.
 */
interface PacketLocation {
  /**
   * Gets the offset of the packet's data.
   */
  readonly offset: number;

  /**
   * Gets the length of its data.
   */
  readonly length: number;
}

/**
 * Hears of the host names a chunk of a capture named for addresses.
 */
export type HostNameSightingsListener = (sightings: readonly HostNameSighting[]) => void;

/**
 * How many of the newest packets keep their bytes in memory, so looking at a packet just captured
 * does not wait on a file the capture is still writing.
 */
const RECENT_PACKETS: number = 4096;

/**
 * One capture's packets, as the main process keeps them: the pcap stream it is read from, written to
 * (or already in) a file, with an index of where each packet is in that file and a summary of each
 * waiting to be sent to the renderer.
 *
 * Packets are not all kept in memory: the newest few thousand are, and the rest are read back from
 * the file when asked for.
 */
export class CaptureSession {
  /**
   * Holds the reader the stream is parsed with.
   */
  private readonly reader: PcapStreamReader = new PcapStreamReader();

  /**
   * Holds where each packet's data is in the file, by number less one.
   */
  private readonly locations: PacketLocation[] = [];

  /**
   * Holds the newest packets' bytes, by number.
   */
  private readonly recent: Map<number, Uint8Array> = new Map<number, Uint8Array>();

  /**
   * Holds the rows read and not yet sent.
   */
  private pending: CapturedPacketRow[] = [];

  /**
   * Holds how many bytes of the stream have been read into whole records, which is where the next
   * record starts in the file.
   */
  private consumed: number = 24;

  /**
   * Creates a session.
   * @param id The capture's id.
   * @param file The file the stream is (being) written to.
   * @param onHostNames Hears of the host names each chunk's packets named — DNS answers, TLS server
   * names — so connections to those addresses can be called by them.
   */
  public constructor(
    public readonly id: string,
    public readonly file: string,
    private readonly onHostNames: HostNameSightingsListener = (): void => undefined,
  ) {}

  /**
   * Gets how many packets have been read.
   * @returns Returns the count.
   */
  public get count(): number {
    return this.locations.length;
  }

  /**
   * Gets the capture's link-layer header type, once its header has been read.
   * @returns Returns the type, or undefined.
   */
  public get linkType(): number | undefined {
    return this.reader.linkType;
  }

  /**
   * Gets how many bytes of the stream hold whole records: a saved copy cut here is a valid capture.
   * @returns Returns the length.
   */
  public get completeLength(): number {
    return this.consumed;
  }

  /**
   * Reads a chunk of the pcap stream, summarising each packet it completes.
   * @param chunk The chunk.
   * @throws PcapFormatError when the stream is not a pcap capture.
   */
  public accept(chunk: Uint8Array): void {
    const records: readonly PcapRecord[] = this.reader.push(chunk);
    const linkType: number = this.reader.linkType ?? 0;
    const sightings: HostNameSighting[] = [];
    for (const record of records) {
      const number: number = this.locations.length + 1;
      this.locations.push({ offset: this.consumed + 16, length: record.data.length });
      this.consumed += 16 + record.data.length;
      this.recent.set(number, record.data);
      this.recent.delete(number - RECENT_PACKETS);
      const dissection: PacketDissection = dissect(linkType, record.data);
      sightings.push(...dissection.hostNames);
      this.pending.push({
        number,
        timestampMs: record.timestampMs,
        length: record.originalLength,
        summary: dissection.finish().summary,
      });
    }
    if (sightings.length > 0) {
      this.onHostNames(sightings);
    }
  }

  /**
   * Takes the rows read since last asked.
   * @returns Returns them, in order.
   */
  public takePending(): CapturedPacketRow[] {
    const taken: CapturedPacketRow[] = this.pending;
    this.pending = [];
    return taken;
  }

  /**
   * Gets one packet's bytes: from memory when it is recent, otherwise from the file.
   * @param number The packet's number, from 1.
   * @returns Returns a promise resolving the packet, or undefined when there is no such packet.
   */
  public async packet(number: number): Promise<CapturedPacket | undefined> {
    const location: PacketLocation | undefined = this.locations[number - 1];
    const linkType: number | undefined = this.reader.linkType;
    if (location === undefined || linkType === undefined) {
      return undefined;
    }
    const cached: Uint8Array | undefined = this.recent.get(number);
    if (cached !== undefined) {
      return { linkType, data: cached };
    }
    const handle: FileHandle = await open(this.file, 'r');
    try {
      const data: Uint8Array = new Uint8Array(location.length);
      await handle.read(data, 0, location.length, location.offset);
      return { linkType, data };
    } finally {
      await handle.close();
    }
  }

  /**
   * Writes the capture to another file: every whole record read so far, as pcap.
   * @param path The file to write.
   */
  public async save(path: string): Promise<void> {
    const length: number = this.consumed;
    await copyFile(this.file, path);
    // A live capture's file may already hold part of the next record; a copy ends on a whole one.
    await truncate(path, length);
  }
}
