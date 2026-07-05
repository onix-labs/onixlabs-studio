import { TestBed } from '@angular/core/testing';
import { Bridge } from '@shared/api/bridge';
import { BinaryPatch, WorkspaceChannel } from '@shared/api/workspace-channels';
import { Tab } from '@shared/angular/services/tabs/tab';
import { BinaryDocumentEntry, BinaryDocuments } from './binary-document';

/**
 * Records the patches passed to the fake write-bytes channel, so save tests can assert what was
 * written. Reset before each test.
 */
let capturedWrites: { path: string; patches: readonly BinaryPatch[] }[] = [];

/**
 * Backing file the fake bridge serves byte windows from: 200 000 bytes (spanning several 64 KiB
 * blocks) where each byte is its offset modulo 256, so a byte's value encodes its position.
 */
const FILE: Uint8Array = new Uint8Array(200000);
for (let index: number = 0; index < FILE.length; index += 1) {
  FILE[index] = index % 256;
}

/**
 * Builds a fake transport whose read-bytes channel serves clamped windows of {@link FILE}.
 */
function fakeBridge(): Bridge {
  return {
    invoke: <T>(channel: string, ...args: unknown[]): Promise<T> => {
      if (channel === (WorkspaceChannel.ReadBytes as string)) {
        const [, offset, length] = args as [string, number, number];
        const start: number = Math.min(offset, FILE.length);
        const end: number = Math.min(start + length, FILE.length);
        return Promise.resolve({ size: FILE.length, offset: start, bytes: FILE.slice(start, end) } as T);
      }
      if (channel === (WorkspaceChannel.WriteBytes as string)) {
        const [path, patches] = args as [string, readonly BinaryPatch[]];
        capturedWrites.push({ path, patches });
        return Promise.resolve(true as T);
      }
      return Promise.resolve(null as T);
    },
    send: (): void => undefined,
    on: (): (() => void) => (): void => undefined,
  };
}

/**
 * Flushes pending microtasks so an in-flight byte-window read settles.
 */
function flush(): Promise<void> {
  return new Promise<void>((resolve: () => void): void => {
    setTimeout(resolve, 0);
  });
}

describe('BinaryDocuments', () => {
  let documents: BinaryDocuments;

  beforeEach(() => {
    capturedWrites = [];
    (window as unknown as { bridge: Bridge }).bridge = fakeBridge();
    TestBed.configureTestingModule({});
    documents = TestBed.inject(BinaryDocuments);
  });

  afterEach(() => {
    delete (window as unknown as { bridge?: unknown }).bridge;
  });

  it('open_createsABinaryTabTitledByFileNameAndLearnsTheSize', async () => {
    const tab: Tab = documents.open('/ws/blob.bin');
    expect(tab.type).toBe('binary');
    expect(tab.title).toBe('blob.bin');
    const entry: BinaryDocumentEntry = documents.get(tab.id)!;
    await flush();
    expect(entry.size()).toBe(FILE.length);
  });

  it('byteAt_returnsLoadedBytesAndNullForUnloadedBlocks', async () => {
    const entry: BinaryDocumentEntry = documents.get(documents.open('/ws/blob.bin').id)!;
    await flush();
    // Block 0 was primed on open, so its bytes are available and encode their offset.
    expect(entry.byteAt(0)).toBe(0);
    expect(entry.byteAt(255)).toBe(255);
    expect(entry.byteAt(256)).toBe(0);
    // An offset in a later block has not been fetched yet.
    expect(entry.byteAt(70000)).toBeNull();
  });

  it('ensureRange_fetchesTheBlocksSpanningAByteRange', async () => {
    const entry: BinaryDocumentEntry = documents.get(documents.open('/ws/blob.bin').id)!;
    await flush();
    entry.ensureRange(70000, 4);
    await flush();
    expect(entry.byteAt(70000)).toBe(70000 % 256);
    expect(entry.byteAt(70003)).toBe(70003 % 256);
  });

  it('selectedBytes_returnsTheLoadedBytesOfTheSelection', async () => {
    const entry: BinaryDocumentEntry = documents.get(documents.open('/ws/blob.bin').id)!;
    await flush();
    entry.selection.set({ start: 10, end: 13 });
    expect(entry.selectedBytes()).toEqual([10, 11, 12]);
  });

  it('reveal_movesTheCursorAndSelectsTheByteClampedToTheFile', async () => {
    const entry: BinaryDocumentEntry = documents.get(documents.open('/ws/blob.bin').id)!;
    await flush();
    entry.reveal(5);
    expect(entry.cursor()).toBe(5);
    expect(entry.selection()).toEqual({ start: 5, end: 6 });

    entry.reveal(FILE.length + 100);
    expect(entry.cursor()).toBe(FILE.length - 1);
  });

  it('open_reusesTheExistingTabAndDocumentForTheSamePath', () => {
    const first: Tab = documents.open('/ws/blob.bin');
    const second: Tab = documents.open('/ws/blob.bin');
    expect(second.id).toBe(first.id);
  });

  it('overwrite_overlaysTheByteAndMarksTheDocumentDirty', async () => {
    const entry: BinaryDocumentEntry = documents.get(documents.open('/ws/blob.bin').id)!;
    await flush();
    expect(entry.dirty()).toBe(false);
    entry.overwrite(2, 0xab);
    expect(entry.byteAt(2)).toBe(0xab);
    expect(entry.byteAt(3)).toBe(3);
    expect(entry.dirty()).toBe(true);
  });

  it('overwrite_backToTheOriginalValueClearsTheEditAndDirtyState', async () => {
    const entry: BinaryDocumentEntry = documents.get(documents.open('/ws/blob.bin').id)!;
    await flush();
    entry.overwrite(2, 0xab);
    expect(entry.dirty()).toBe(true);
    // Byte 2's on-disk value is 2 (offset modulo 256); typing it back should leave the document clean.
    entry.overwrite(2, 2);
    expect(entry.byteAt(2)).toBe(2);
    expect(entry.dirty()).toBe(false);
  });

  it('save_writesCoalescedPatchesThenClearsDirty', async () => {
    const entry: BinaryDocumentEntry = documents.get(documents.open('/ws/blob.bin').id)!;
    await flush();
    entry.overwrite(2, 0xaa);
    entry.overwrite(3, 0xbb);
    entry.overwrite(10, 0xcc);
    const written: boolean = await entry.save();
    expect(written).toBe(true);
    expect(capturedWrites).toEqual([
      {
        path: '/ws/blob.bin',
        patches: [
          { offset: 2, bytes: [0xaa, 0xbb] },
          { offset: 10, bytes: [0xcc] },
        ],
      },
    ]);
    expect(entry.dirty()).toBe(false);
    // The saved edits are folded into the cache, so they persist after the dirty state clears.
    expect(entry.byteAt(2)).toBe(0xaa);
    expect(entry.byteAt(10)).toBe(0xcc);
  });

  it('save_withNoEditsWritesNothingAndReportsSuccess', async () => {
    const entry: BinaryDocumentEntry = documents.get(documents.open('/ws/blob.bin').id)!;
    await flush();
    const written: boolean = await entry.save();
    expect(written).toBe(true);
    expect(capturedWrites).toEqual([]);
  });
});
