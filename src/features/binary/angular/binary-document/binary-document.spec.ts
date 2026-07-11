import { TestBed } from '@angular/core/testing';
import { Bridge } from '@shared/api/bridge';
import { BinaryPatch, BinarySpan, WorkspaceChannel } from '@shared/api/workspace-channels';
import { Tab } from '@shared/angular/services/tabs/tab';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import { BinaryDocumentEntry, BinaryDocuments } from './binary-document';

/**
 * Records the patches passed to the fake write-bytes channel, so save tests can assert what was
 * written. Reset before each test.
 */
let capturedWrites: { path: string; patches: readonly BinaryPatch[] }[] = [];

/**
 * Records the spans passed to the fake write-pieces channel, so structural-save tests can assert the
 * streamed rewrite. Reset before each test.
 */
let capturedPieceWrites: { path: string; spans: readonly BinarySpan[]; added: number[] }[] = [];

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
        return Promise.resolve({
          size: FILE.length,
          offset: start,
          bytes: FILE.slice(start, end),
        } as T);
      }
      if (channel === (WorkspaceChannel.WriteBytes as string)) {
        const [path, patches] = args as [string, readonly BinaryPatch[]];
        capturedWrites.push({ path, patches });
        return Promise.resolve(true as T);
      }
      if (channel === (WorkspaceChannel.WritePieces as string)) {
        const [path, spans, added] = args as [string, readonly BinarySpan[], Uint8Array];
        capturedPieceWrites.push({ path, spans, added: Array.from(added) });
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
    capturedPieceWrites = [];
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

  it('dirtyEdit_marksTheTabDirty_andSaveClearsIt', async () => {
    const tab: Tab = documents.open('/ws/blob.bin');
    const entry: BinaryDocumentEntry = documents.get(tab.id)!;
    const tabs: Tabs = TestBed.inject(Tabs);
    await flush();
    TestBed.tick();
    expect(tabs.get(tab.id)?.dirty ?? false).toBe(false);

    entry.overwrite(0, 0xff);
    TestBed.tick();
    expect(tabs.get(tab.id)?.dirty).toBe(true);

    await entry.save();
    TestBed.tick();
    expect(tabs.get(tab.id)?.dirty).toBe(false);
  });

  it('dirtyDocuments_listsOnlyDocumentsWithUnsavedEdits', async () => {
    const clean: Tab = documents.open('/ws/clean.bin');
    const edited: Tab = documents.open('/ws/blob.bin');
    const entry: BinaryDocumentEntry = documents.get(edited.id)!;
    await flush();
    entry.overwrite(0, 0xff);

    expect(documents.dirtyDocuments()).toEqual([{ id: edited.id, name: 'blob.bin' }]);
    expect(clean.id === edited.id).toBe(false);
  });

  it('save_byId_savesTheDocumentAndUnknownIdsReportSuccess', async () => {
    const tab: Tab = documents.open('/ws/blob.bin');
    const entry: BinaryDocumentEntry = documents.get(tab.id)!;
    await flush();
    entry.overwrite(0, 0xff);

    expect(await documents.save(tab.id)).toBe(true);
    expect(entry.dirty()).toBe(false);
    expect(await documents.save('missing-tab')).toBe(true);
  });

  it('open_reusesTheExistingTabAndDocumentForTheSamePath', () => {
    const first: Tab = documents.open('/ws/blob.bin');
    const second: Tab = documents.open('/ws/blob.bin');
    expect(second.id).toBe(first.id);
  });

  it('instructionRangeAt_returnsTheRangeOfTheInstructionCoveringAnOffset', async () => {
    const entry: BinaryDocumentEntry = documents.get(documents.open('/ws/blob.bin').id)!;
    await flush();
    entry.instructions.set([
      { startOffset: 10, byteLength: 3, mnemonic: 'mov', operands: 'a, b', raw: [0, 0, 0] },
      { startOffset: 13, byteLength: 2, mnemonic: 'add', operands: 'c', raw: [0, 0] },
    ]);
    expect(entry.instructionRangeAt(11)).toEqual({ start: 10, end: 13 });
    expect(entry.instructionRangeAt(13)).toEqual({ start: 13, end: 15 });
    expect(entry.instructionRangeAt(99)).toBeNull();
  });

  it('blockCache_evictsLeastRecentlyUsedBlocksBeyondTheResidentCap', async () => {
    const block: number = 64 * 1024;
    const hugeSize: number = 200 * block;
    (window as unknown as { bridge: Bridge }).bridge = {
      invoke: <T>(channel: string, ...args: unknown[]): Promise<T> => {
        if (channel === (WorkspaceChannel.ReadBytes as string)) {
          const [, offset] = args as [string, number, number];
          return Promise.resolve({ size: hugeSize, offset, bytes: new Uint8Array(4) } as T);
        }
        return Promise.resolve(null as T);
      },
      send: (): void => undefined,
      on: (): (() => void) => (): void => undefined,
    };
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    const large: BinaryDocuments = TestBed.inject(BinaryDocuments);
    const entry: BinaryDocumentEntry = large.get(large.open('/ws/huge.bin').id)!;
    await flush();
    // Visit far more distinct blocks than the cache may hold; memory must stay bounded.
    for (let index: number = 0; index < 120; index += 1) {
      entry.ensureRange(index * block, 4);
    }
    await flush();
    expect(entry.residentBlockCount()).toBeGreaterThan(0);
    expect(entry.residentBlockCount()).toBeLessThanOrEqual(64);
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

  it('overwrite_isUndoneToReturnToACleanDocument', async () => {
    const entry: BinaryDocumentEntry = documents.get(documents.open('/ws/blob.bin').id)!;
    await flush();
    entry.overwrite(2, 0xab);
    expect(entry.byteAt(2)).toBe(0xab);
    expect(entry.dirty()).toBe(true);
    expect(entry.canUndo()).toBe(true);
    entry.undo();
    expect(entry.byteAt(2)).toBe(2);
    expect(entry.dirty()).toBe(false);
    expect(entry.canRedo()).toBe(true);
  });

  it('insertByte_growsTheDocumentAndShiftsFollowingBytes', async () => {
    const entry: BinaryDocumentEntry = documents.get(documents.open('/ws/blob.bin').id)!;
    await flush();
    entry.insertByte(2, 0xff);
    expect(entry.size()).toBe(FILE.length + 1);
    expect(entry.byteAt(1)).toBe(1);
    expect(entry.byteAt(2)).toBe(0xff);
    expect(entry.byteAt(3)).toBe(2);
    expect(entry.byteAt(4)).toBe(3);
    expect(entry.dirty()).toBe(true);
  });

  it('deleteBytes_shrinksTheDocumentAndClosesTheGap', async () => {
    const entry: BinaryDocumentEntry = documents.get(documents.open('/ws/blob.bin').id)!;
    await flush();
    entry.deleteBytes(2, 1);
    expect(entry.size()).toBe(FILE.length - 1);
    expect(entry.byteAt(1)).toBe(1);
    expect(entry.byteAt(2)).toBe(3);
    expect(entry.byteAt(3)).toBe(4);
    expect(entry.dirty()).toBe(true);
  });

  it('undoAndRedo_stepThroughAnInsert', async () => {
    const entry: BinaryDocumentEntry = documents.get(documents.open('/ws/blob.bin').id)!;
    await flush();
    entry.insertByte(2, 0xff);
    entry.undo();
    expect(entry.size()).toBe(FILE.length);
    expect(entry.byteAt(2)).toBe(2);
    expect(entry.dirty()).toBe(false);
    entry.redo();
    expect(entry.size()).toBe(FILE.length + 1);
    expect(entry.byteAt(2)).toBe(0xff);
    expect(entry.dirty()).toBe(true);
  });

  it('save_afterInsertRewritesViaWritePiecesThenClearsDirty', async () => {
    const entry: BinaryDocumentEntry = documents.get(documents.open('/ws/blob.bin').id)!;
    await flush();
    entry.insertByte(2, 0xff);
    const written: boolean = await entry.save();
    expect(written).toBe(true);
    // An overwrite-only save patches in place; an insert must stream a full rewrite instead.
    expect(capturedWrites).toEqual([]);
    expect(capturedPieceWrites).toEqual([
      {
        path: '/ws/blob.bin',
        spans: [
          { source: 'original', start: 0, length: 2 },
          { source: 'added', start: 0, length: 1 },
          { source: 'original', start: 2, length: FILE.length - 2 },
        ],
        added: [0xff],
      },
    ]);
    expect(entry.dirty()).toBe(false);
    expect(entry.canUndo()).toBe(false);
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
