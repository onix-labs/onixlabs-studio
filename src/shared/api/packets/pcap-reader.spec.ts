import { LINKTYPE_ETHERNET, LINKTYPE_RAW, PcapRecord } from './packet-model';
import { PcapFormatError, PcapStreamReader } from './pcap-reader';
import { pcapHeader, pcapRecord } from './pcap-writer';
import { bytesOf } from './packet-samples.testing';

/**
 * Builds a record.
 * @param timestampMs When it was captured.
 * @param data Its bytes.
 * @returns Returns the record.
 */
function record(timestampMs: number, data: readonly number[]): PcapRecord {
  return { timestampMs, originalLength: data.length, data: Uint8Array.from(data) };
}

describe('PcapStreamReader', () => {
  const capture: Uint8Array = bytesOf(
    pcapHeader(LINKTYPE_ETHERNET, 65535),
    pcapRecord(record(1_700_000_000_123.456, [1, 2, 3])),
    pcapRecord(record(1_700_000_001_000, [4, 5, 6, 7])),
  );

  it('readsTheHeaderAndEveryRecord_inOneChunk', () => {
    const reader: PcapStreamReader = new PcapStreamReader();

    const records: readonly PcapRecord[] = reader.push(capture);

    expect(reader.linkType).toBe(LINKTYPE_ETHERNET);
    expect(reader.snapshotLength).toBe(65535);
    expect(records.map((entry: PcapRecord): readonly number[] => Array.from(entry.data))).toEqual([
      [1, 2, 3],
      [4, 5, 6, 7],
    ]);
    expect(records[0].timestampMs).toBeCloseTo(1_700_000_000_123.456, 3);
  });

  it('readsTheSameRecords_whateverSizeTheChunksArrive', () => {
    for (const size of [1, 3, 7, 16, 25]) {
      const reader: PcapStreamReader = new PcapStreamReader();
      const records: PcapRecord[] = [];
      for (let offset: number = 0; offset < capture.length; offset += size) {
        records.push(...reader.push(capture.subarray(offset, offset + size)));
      }
      expect(records).toHaveLength(2);
      expect(Array.from(records[1].data)).toEqual([4, 5, 6, 7]);
      expect(reader.buffered).toBe(0);
    }
  });

  it('readsBigEndianNanosecondCaptures', () => {
    const header: Uint8Array = new Uint8Array(24);
    const view: DataView = new DataView(header.buffer);
    view.setUint32(0, 0xa1b23c4d, false);
    view.setUint32(16, 65535, false);
    view.setUint32(20, LINKTYPE_RAW, false);
    const body: Uint8Array = new Uint8Array(17);
    const bodyView: DataView = new DataView(body.buffer);
    bodyView.setUint32(0, 10, false);
    bodyView.setUint32(4, 500_000_000, false);
    bodyView.setUint32(8, 1, false);
    bodyView.setUint32(12, 1, false);

    const records: readonly PcapRecord[] = new PcapStreamReader().push(bytesOf(header, body));

    expect(records[0].timestampMs).toBe(10_500);
  });

  it('refusesWhatIsNotPcap', () => {
    expect(() =>
      new PcapStreamReader().push(new TextEncoder().encode('tcpdump: permission denied')),
    ).toThrow(PcapFormatError);
    expect(() =>
      new PcapStreamReader().push(
        Uint8Array.from([0x0a, 0x0d, 0x0d, 0x0a, ...new Array<number>(20).fill(0)]),
      ),
    ).toThrow(/pcapng/);
  });

  it('refusesARecordClaimingAnAbsurdLength', () => {
    const reader: PcapStreamReader = new PcapStreamReader();
    reader.push(pcapHeader(LINKTYPE_ETHERNET));
    const header: Uint8Array = new Uint8Array(16);
    new DataView(header.buffer).setUint32(8, 0x7fffffff, true);

    expect(() => reader.push(header)).toThrow(PcapFormatError);
  });
});
