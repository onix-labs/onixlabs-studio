import { PcapRecord } from './packet-model';

/**
 * Writes the global header of a little-endian, microsecond pcap capture.
 * @param linkType The capture's link-layer header type.
 * @param snapshotLength The most bytes recorded of any packet.
 * @returns Returns the header's bytes.
 */
export function pcapHeader(linkType: number, snapshotLength: number = 262144): Uint8Array {
  const header: Uint8Array = new Uint8Array(24);
  const view: DataView = new DataView(header.buffer);
  view.setUint32(0, 0xa1b2c3d4, true);
  view.setUint16(4, 2, true);
  view.setUint16(6, 4, true);
  view.setUint32(16, snapshotLength, true);
  view.setUint32(20, linkType, true);
  return header;
}

/**
 * Writes one record of a little-endian, microsecond pcap capture.
 * @param record The packet.
 * @returns Returns the record's bytes: its header, then its data.
 */
export function pcapRecord(record: PcapRecord): Uint8Array {
  const bytes: Uint8Array = new Uint8Array(16 + record.data.length);
  const view: DataView = new DataView(bytes.buffer);
  const seconds: number = Math.floor(record.timestampMs / 1000);
  view.setUint32(0, seconds, true);
  view.setUint32(4, Math.round((record.timestampMs - seconds * 1000) * 1000), true);
  view.setUint32(8, record.data.length, true);
  view.setUint32(12, record.originalLength, true);
  bytes.set(record.data, 16);
  return bytes;
}
