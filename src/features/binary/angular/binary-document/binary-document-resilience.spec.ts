import { TestBed } from '@angular/core/testing';
import { CodeListing } from '@shared/api/code-listing';
import { DecoderDescription } from '@shared/api/decoder-protocol';
import { BinaryChunk, BinaryPatch, BinarySpan } from '@shared/api/workspace-channels';
import { FileConflicts } from '@shared/angular/services/file-conflicts/file-conflicts';
import { FileWatch } from '@shared/angular/services/file-watch/file-watch';
import { Tab } from '@shared/angular/services/tabs/tab';
import { Workspace } from '@shared/angular/services/workspace/workspace';
import { BinaryAssembly } from '../binary-assembly/binary-assembly';
import { BinaryDisassembly } from '../binary-disassembly/binary-disassembly';
import { BinaryDocumentEntry, BinaryDocuments } from './binary-document';

/**
 * What a raised conflict offers.
 */
type ConflictHandlers = Parameters<FileConflicts['raise']>[1];

/**
 * The size of a block, as the document reads them.
 */
const blockSize: number = 64 * 1024;

/**
 * A read the test finishes by hand.
 */
interface HeldRead {
  readonly offset: number;
  readonly finish: (chunk: BinaryChunk | null) => void;
}

/**
 * The bytes of a file on a fake disk, computed rather than stored so a file can be large.
 */
class FakeDisk {
  public size: number = 256;
  public salt: number = 0;
  public failing: boolean = false;
  public reads: number = 0;
  public hold: boolean = false;
  public held: HeldRead[] = [];
  public companion: Uint8Array | null = null;
  public writeResult: boolean | Error = true;
  public writes: (readonly BinaryPatch[])[] = [];
  public rewrites: (readonly BinarySpan[])[] = [];
  public finishWrite: ((result: boolean) => void) | null = null;
  public holdWrites: boolean = false;
  public firstBytes: readonly number[] = [];

  public byte(offset: number): number {
    return offset < this.firstBytes.length
      ? (this.firstBytes[offset] ?? 0)
      : (offset + this.salt) % 251;
  }

  public chunk(offset: number, length: number): BinaryChunk {
    const end: number = Math.min(offset + length, this.size);
    const bytes: Uint8Array = new Uint8Array(Math.max(0, end - offset));
    for (let index: number = 0; index < bytes.length; index += 1) {
      bytes[index] = this.byte(offset + index);
    }
    return { size: this.size, offset, bytes };
  }

  public async readBytes(
    path: string,
    offset: number,
    length: number,
  ): Promise<BinaryChunk | null> {
    if (path.endsWith('.pdb')) {
      return this.companion === null
        ? null
        : { size: this.companion.length, offset: 0, bytes: this.companion };
    }
    this.reads += 1;
    if (this.failing) {
      throw new Error('the bridge has gone');
    }
    if (this.hold) {
      return new Promise<BinaryChunk | null>(
        (resolve: (chunk: BinaryChunk | null) => void): void => {
          this.held.push({ offset, finish: resolve });
        },
      );
    }
    return Promise.resolve(this.chunk(offset, length));
  }

  public async writeBytes(_path: string, patches: readonly BinaryPatch[]): Promise<boolean> {
    this.writes.push(patches);
    return this.finishTheWrite();
  }

  public async writePieces(_path: string, spans: readonly BinarySpan[]): Promise<boolean> {
    this.rewrites.push(spans);
    return this.finishTheWrite();
  }

  private async finishTheWrite(): Promise<boolean> {
    if (this.holdWrites) {
      return new Promise<boolean>((resolve: (result: boolean) => void): void => {
        this.finishWrite = resolve;
      });
    }
    if (this.writeResult instanceof Error) {
      throw this.writeResult;
    }
    return Promise.resolve(this.writeResult);
  }
}

/**
 * A decoder that answers from a script.
 */
class FakeDecoder {
  public info: DecoderDescription | null = {
    id: 'fixture',
    name: 'Fixture',
    requiresWholeFile: false,
  } as unknown as DecoderDescription;

  public listing: CodeListing | null = { sections: [] } as unknown as CodeListing;
  public calls: {
    bytes: Uint8Array;
    base: number;
    companions: Readonly<Record<string, Uint8Array>> | undefined;
  }[] = [];

  public async decoderInfo(): Promise<DecoderDescription | null> {
    return Promise.resolve(this.info);
  }

  public async decodeListing(
    _format: string,
    bytes: Uint8Array,
    base: number,
    _size?: number,
    _path?: string,
    companions?: Readonly<Record<string, Uint8Array>>,
  ): Promise<CodeListing | null> {
    this.calls.push({ bytes, base, companions });
    return Promise.resolve(this.listing);
  }
}

/**
 * The start of a 64-bit ELF the sniffer recognises as code.
 */
function elfHeader(): readonly number[] {
  const header: number[] = new Array<number>(64).fill(0);
  header.splice(0, 7, 0x7f, 0x45, 0x4c, 0x46, 2, 1, 1);
  header[16] = 2;
  header[18] = 0x3e;
  return header;
}

/**
 * A listing with one row at each offset.
 */
function listingAt(...offsets: readonly number[]): CodeListing {
  return {
    sections: [
      {
        rows: offsets.map((fileOffset: number) => ({
          fileOffset,
          bytes: [0x90],
          mnemonic: 'nop',
          operands: '',
        })),
      },
    ],
  } as unknown as CodeListing;
}

/**
 * Waits past the viewport debounce and whatever follows it.
 */
function afterDebounce(): Promise<void> {
  return new Promise<void>((resolve: () => void): void => {
    setTimeout(resolve, 180);
  });
}

describe('BinaryDocumentEntry resilience', () => {
  let disk: FakeDisk;
  let decoder: FakeDecoder;
  let entry: BinaryDocumentEntry;
  let unhandled: unknown[];

  /**
   * Records a rejection nothing handled, which a run would otherwise only fail on at the end.
   */
  const onUnhandled: (reason: unknown) => void = (reason: unknown): void => {
    unhandled.push(reason);
  };

  /**
   * Builds a document over the fake disk.
   */
  function open(
    options: { decodeLimitMb?: number; symbols?: boolean; jump?: boolean } = {},
    path: string = '/fixture/app.dll',
  ): BinaryDocumentEntry {
    return new BinaryDocumentEntry(
      'tab-1',
      path,
      'app.dll',
      disk as unknown as Workspace,
      decoder as unknown as BinaryDisassembly,
      { assemble: () => Promise.resolve({ bytes: [] }) } as unknown as BinaryAssembly,
      {
        decodeLimitMb: (): number => options.decodeLimitMb ?? 64,
        loadSymbolFiles: (): boolean => options.symbols ?? true,
        jumpToEntry: (): boolean => options.jump ?? false,
      },
    );
  }

  beforeEach((): void => {
    disk = new FakeDisk();
    decoder = new FakeDecoder();
    entry = open();
    unhandled = [];
    process.on('unhandledRejection', onUnhandled);
  });

  afterEach(async (): Promise<void> => {
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 0);
    });
    process.off('unhandledRejection', onUnhandled);
    entry.dispose();
    expect(unhandled).toEqual([]);
  });

  describe('reads that fail', () => {
    it('prime_whenTheBridgeRejects_leavesTheDocumentEmptyAndRetriable', async () => {
      disk.failing = true;

      await entry.whenReady();

      expect(entry.size()).toBe(0);
      expect(entry.byteAt(0)).toBeNull();

      disk.failing = false;
      await entry.whenReady();

      expect(entry.size()).toBe(256);
    });

    it('patch_whenTheFirstReadRejects_reportsFailureWithoutEditing', async () => {
      disk.failing = true;

      expect(await entry.patch(0, [1])).toBe(false);
      expect(entry.dirty()).toBe(false);
    });

    it('readBytes_stopsAtTheFirstBlockThatFailsToLoad', async () => {
      disk.size = blockSize * 3;
      await entry.whenReady();
      const read: FakeDisk['readBytes'] = disk.readBytes.bind(disk);
      disk.readBytes = (
        path: string,
        offset: number,
        length: number,
      ): Promise<BinaryChunk | null> =>
        offset >= blockSize ? Promise.reject(new Error('gone')) : read(path, offset, length);

      const bytes: number[] = await entry.readBytes(blockSize - 2, 10);

      expect(bytes).toEqual([disk.byte(blockSize - 2), disk.byte(blockSize - 1)]);
    });

    it('reloadFromDisk_whenTheBridgeRejects_keepsTheDocumentAsItWas', async () => {
      await entry.whenReady();
      entry.overwrite(0, 9);
      disk.failing = true;

      await entry.reloadFromDisk();

      expect(entry.byteAt(0)).toBe(9);
      expect(entry.dirty()).toBe(true);
    });
  });

  describe('long reads', () => {
    it('readBytes_ofMoreThanTheCacheHolds_returnsEveryByte', async () => {
      disk.size = 6 * 1024 * 1024;

      const bytes: number[] = await entry.readBytes(0, disk.size);

      expect(bytes).toHaveLength(disk.size);
      expect(bytes[0]).toBe(disk.byte(0));
      expect(bytes[disk.size - 1]).toBe(disk.byte(disk.size - 1));
      expect(entry.residentBlockCount()).toBeLessThanOrEqual(64);
    });

    it('wholeFileDecode_ofALargeAssembly_seesTheWholeFile', async () => {
      disk.size = 6 * 1024 * 1024;
      disk.firstBytes = elfHeader();
      decoder.info = { requiresWholeFile: true } as unknown as DecoderDescription;
      await entry.whenReady();
      entry.ensureRange(0, 256);

      entry.loadDisassembly(0, 256);
      await vi.waitFor((): void => {
        expect(decoder.calls).toHaveLength(1);
      });

      expect(decoder.calls[0]?.bytes.length).toBe(disk.size);
    });
  });

  describe('saving', () => {
    it('save_whenTheBridgeRejects_reportsFailureAndKeepsTheEdits', async () => {
      await entry.whenReady();
      entry.overwrite(1, 7);
      disk.writeResult = new Error('disk full');

      expect(await entry.save()).toBe(false);

      expect(entry.dirty()).toBe(true);
      expect(entry.byteAt(1)).toBe(7);
      expect(entry.canUndo()).toBe(true);
    });

    it('save_whenARewriteIsRefused_keepsTheEdits', async () => {
      await entry.whenReady();
      entry.insertByte(0, 7);
      disk.writeResult = false;

      expect(await entry.save()).toBe(false);

      expect(entry.size()).toBe(257);
      expect(entry.byteAt(0)).toBe(7);
    });

    it('typing_whileASaveWrites_isRefusedRatherThanSilentlyDiscarded', async () => {
      await entry.whenReady();
      entry.overwrite(1, 7);
      disk.holdWrites = true;
      const saving: Promise<boolean> = entry.save();

      entry.overwrite(2, 8);
      entry.insertByte(0, 9);
      entry.deleteBytes(3, 1);
      entry.undo();
      entry.redo();

      expect(entry.byteAt(1)).toBe(7);
      expect(entry.byteAt(2)).toBe(disk.byte(2));
      expect(entry.size()).toBe(256);
      disk.finishWrite?.(true);
      expect(await saving).toBe(true);
      expect(entry.dirty()).toBe(false);
    });

    it('agentEdit_whileASaveWrites_waitsForItAndIsKept', async () => {
      await entry.whenReady();
      entry.overwrite(1, 7);
      disk.holdWrites = true;
      const saving: Promise<boolean> = entry.save();

      const patching: Promise<boolean> = entry.patch(2, [8]);
      await Promise.resolve();
      disk.finishWrite?.(true);
      await saving;

      expect(await patching).toBe(true);
      expect(entry.byteAt(2)).toBe(8);
      expect(entry.dirty()).toBe(true);
    });

    it('editing_resumesAfterASaveFails', async () => {
      await entry.whenReady();
      entry.overwrite(1, 7);
      disk.writeResult = false;
      await entry.save();

      entry.overwrite(2, 8);

      expect(entry.byteAt(2)).toBe(8);
    });

    it('twoSaves_atOnce_writeOnce', async () => {
      await entry.whenReady();
      entry.overwrite(1, 7);
      disk.holdWrites = true;

      const first: Promise<boolean> = entry.save();
      const second: Promise<boolean> = entry.save();
      disk.finishWrite?.(true);

      expect(await Promise.all([first, second])).toEqual([true, true]);
      expect(disk.writes).toHaveLength(1);
    });

    it('recentlySaved_tellsTheSavesOwnEchoFromAnExternalChange', async () => {
      await entry.whenReady();
      expect(entry.recentlySaved(2000)).toBe(false);
      entry.overwrite(1, 7);

      await entry.save();

      expect(entry.recentlySaved(2000)).toBe(true);
    });
  });

  describe('reads overtaken by the file changing', () => {
    it('rewrite_discardsAReadOfTheOldFileStillInFlight', async () => {
      disk.size = blockSize * 3;
      await entry.whenReady();
      disk.hold = true;
      entry.ensureRange(blockSize, 16);
      const old: HeldRead | undefined = disk.held[0];
      entry.insertByte(0, 7);
      disk.hold = false;
      disk.salt = 1;

      await entry.save();
      old?.finish(new FakeDisk().chunk(blockSize, 16));
      await Promise.resolve();
      await entry.readBytes(blockSize, 1);

      expect(entry.byteAt(blockSize)).toBe(disk.byte(blockSize));
    });

    it('reload_discardsAReadOfTheOldFileStillInFlight', async () => {
      disk.size = blockSize * 3;
      await entry.whenReady();
      disk.hold = true;
      entry.ensureRange(blockSize, 16);
      const old: HeldRead | undefined = disk.held[0];
      disk.hold = false;
      disk.salt = 1;

      await entry.reloadFromDisk();
      old?.finish({ size: disk.size, offset: blockSize, bytes: new Uint8Array(blockSize) });
      await Promise.resolve();
      await entry.readBytes(blockSize, 1);

      expect(entry.byteAt(blockSize)).toBe(disk.byte(blockSize));
    });

    it('reload_thatShrinksTheFile_pullsTheCursorBackInside', async () => {
      await entry.whenReady();
      entry.cursor.set(200);
      entry.selection.set({ start: 200, end: 201 });
      disk.size = 10;

      await entry.reloadFromDisk();

      expect(entry.size()).toBe(10);
      expect(entry.cursor()).toBe(9);
      expect(entry.selection()).toBeNull();
    });

    it('reload_ofAnEmptiedFile_clearsTheCursor', async () => {
      await entry.whenReady();
      entry.cursor.set(0);
      disk.size = 0;

      await entry.reloadFromDisk();

      expect(entry.cursor()).toBeNull();
    });

    it('reload_discardsPendingEditsAndTheirHistory', async () => {
      await entry.whenReady();
      entry.overwrite(1, 7);

      await entry.reloadFromDisk();

      expect(entry.dirty()).toBe(false);
      expect(entry.canUndo()).toBe(false);
      expect(entry.byteAt(1)).toBe(disk.byte(1));
    });
  });

  describe('opening on code', () => {
    it('open_ofARecognisedFile_sniffsItsFormat', async () => {
      disk.firstBytes = elfHeader();
      entry = open({ jump: true });

      await entry.whenReady();

      expect(entry.format().kind).not.toBe('unknown');
    });

    it('format_isSniffedOnce', async () => {
      await entry.whenReady();
      const sniffed: unknown = entry.format();

      await entry.reloadFromDisk();

      expect(entry.format()).toBe(sniffed);
    });
  });

  describe('decoding', () => {
    /**
     * Prepares a recognised file loaded up to the viewport.
     */
    async function loaded(options?: { decodeLimitMb?: number; symbols?: boolean }): Promise<void> {
      disk.firstBytes = elfHeader();
      entry.dispose();
      entry = open(options);
      await entry.whenReady();
    }

    it('loadDisassembly_ofAnUnknownFormat_clearsTheListingAndAsksNobody', async () => {
      await entry.whenReady();
      entry.listing.set(listingAt(1));

      entry.loadDisassembly(0, 16);
      await afterDebounce();

      expect(entry.listing()).toBeNull();
      expect(decoder.calls).toEqual([]);
    });

    it('loadDisassembly_settlesOnTheLastViewport', async () => {
      await loaded();
      decoder.listing = listingAt(32);

      entry.loadDisassembly(0, 16);
      entry.loadDisassembly(32, 16);
      await afterDebounce();

      expect(decoder.calls).toHaveLength(1);
      expect(decoder.calls[0]?.base).toBe(16);
      expect(entry.instructions()[0]?.startOffset).toBe(32);
    });

    it('loadDisassembly_ignoresAnAnswerOvertakenByAnotherScroll', async () => {
      await loaded();
      let finish: (listing: CodeListing) => void = (): void => undefined;
      decoder.decodeListing = async (): Promise<CodeListing> =>
        new Promise<CodeListing>((resolve: (listing: CodeListing) => void): void => {
          finish = resolve;
        });
      entry.loadDisassembly(0, 16);
      await afterDebounce();

      entry.loadDisassembly(32, 16);
      finish(listingAt(1));
      await Promise.resolve();
      await Promise.resolve();

      expect(entry.listing()).toBeNull();
    });

    it('loadDisassembly_withNoDecoderInstalled_showsNoListing', async () => {
      await loaded();
      decoder.info = null;

      entry.loadDisassembly(0, 16);
      await afterDebounce();

      expect(entry.listing()).toBeNull();
    });

    it('dispose_cancelsADecodeStillWaitingOnTheDebounce', async () => {
      await loaded();

      entry.loadDisassembly(0, 16);
      entry.dispose();
      await afterDebounce();

      expect(decoder.calls).toEqual([]);
    });

    it('wholeFileDecoder_isAskedOncePerVersion_notOncePerScroll', async () => {
      await loaded();
      decoder.info = { requiresWholeFile: true } as unknown as DecoderDescription;
      entry.loadDisassembly(0, 16);
      await afterDebounce();
      entry.loadDisassembly(32, 16);
      await afterDebounce();
      expect(decoder.calls).toHaveLength(1);

      entry.overwrite(100, 1);
      entry.loadDisassembly(32, 16);
      await afterDebounce();

      expect(decoder.calls).toHaveLength(2);
    });

    it('wholeFileDecoder_retriesAfterAnEmptyAnswer', async () => {
      await loaded();
      decoder.info = { requiresWholeFile: true } as unknown as DecoderDescription;
      decoder.listing = null;
      entry.loadDisassembly(0, 16);
      await afterDebounce();

      entry.loadDisassembly(0, 16);
      await afterDebounce();

      expect(decoder.calls).toHaveLength(2);
    });

    it('wholeFileDecoder_overTheLimit_isSkippedAndSaysSo', async () => {
      disk.size = 2 * 1024 * 1024;
      await loaded({ decodeLimitMb: 1 });
      decoder.info = { requiresWholeFile: true } as unknown as DecoderDescription;

      entry.loadDisassembly(0, 16);
      await afterDebounce();

      expect(entry.decodeSkipped()).toBe(disk.size);
      expect(decoder.calls).toEqual([]);
    });

    it('wholeFileDecoder_withNoLimit_readsAnySize', async () => {
      disk.size = 2 * 1024 * 1024;
      await loaded({ decodeLimitMb: 0 });
      decoder.info = { requiresWholeFile: true } as unknown as DecoderDescription;

      entry.loadDisassembly(0, 16);
      await vi.waitFor((): void => {
        expect(decoder.calls).toHaveLength(1);
      });

      expect(entry.decodeSkipped()).toBeNull();
    });

    it('symbolFile_isHandedToTheDecoder', async () => {
      await loaded();
      decoder.info = { requiresWholeFile: true } as unknown as DecoderDescription;
      disk.companion = new Uint8Array([1, 2]);

      entry.loadDisassembly(0, 16);
      await afterDebounce();

      expect(Array.from(decoder.calls[0]?.companions?.['pdb'] ?? [])).toEqual([1, 2]);
    });

    it('symbolFile_isLeftAlone_whenTurnedOffOrAbsent', async () => {
      await loaded({ symbols: false });
      decoder.info = { requiresWholeFile: true } as unknown as DecoderDescription;
      disk.companion = new Uint8Array([1, 2]);
      entry.loadDisassembly(0, 16);
      await afterDebounce();
      expect(decoder.calls[0]?.companions).toBeUndefined();

      disk.companion = new Uint8Array(0);
      entry.overwrite(1, 1);
      await entry.save();
      entry.dispose();
      entry = open();
      await entry.whenReady();
      entry.loadDisassembly(0, 16);
      await afterDebounce();

      expect(decoder.calls[1]?.companions).toBeUndefined();
    });

    it('disassembleRange_ofAnUnknownFormat_saysItDoesNotApply', async () => {
      expect(await entry.disassembleRange(0, 16)).toBeNull();
    });

    it('disassembleRange_outsideTheFile_isEmpty', async () => {
      await loaded();

      expect(await entry.disassembleRange(9999, 16)).toEqual([]);
    });

    it('disassembleRange_withNoDecoder_saysItDoesNotApply', async () => {
      await loaded();
      decoder.info = null;

      expect(await entry.disassembleRange(0, 16)).toBeNull();
    });

    it('disassembleRange_keepsTheInstructionsStartingInTheRange', async () => {
      await loaded();
      decoder.listing = listingAt(0, 20, 40);

      const instructions: readonly { startOffset: number }[] | null = await entry.disassembleRange(
        16,
        8,
      );

      expect(instructions?.map((row: { startOffset: number }): number => row.startOffset)).toEqual([
        20,
      ]);
      expect(decoder.calls[0]?.base).toBe(0);
    });

    it('disassembleRange_whenTheDecoderDeclines_saysItDoesNotApply', async () => {
      await loaded();
      decoder.listing = null;

      expect(await entry.disassembleRange(0, 16)).toBeNull();
    });

    it('disassembleRange_withAWholeFileDecoder_sendsTheWholeFile', async () => {
      await loaded();
      decoder.info = { requiresWholeFile: true } as unknown as DecoderDescription;
      decoder.listing = listingAt(0);

      await entry.disassembleRange(0, 16);

      expect(decoder.calls[0]?.bytes).toHaveLength(256);
      expect(decoder.calls[0]?.base).toBe(0);
    });

    it('instructions_leaveOutRowsWithNoFileOffset', async () => {
      await entry.whenReady();

      entry.listing.set({
        sections: [{ rows: [{ mnemonic: 'label:' }, { fileOffset: 4, mnemonic: 'nop' }] }],
      } as unknown as CodeListing);

      expect(entry.instructions()).toHaveLength(1);
      expect(entry.instructions()[0]?.byteLength).toBe(1);
    });
  });
});

describe('BinaryDocuments on-disk changes', () => {
  /**
   * The file-watch fake: changes are fired by hand.
   */
  class FakeWatch {
    public listener: (() => void) | null = null;
    public disposed: number = 0;

    public watchPath(_path: string, listener: () => void): () => void {
      this.listener = listener;
      return (): void => {
        this.disposed += 1;
      };
    }
  }

  /**
   * The conflicts fake: records what was raised.
   */
  class FakeConflicts {
    public cleanReloads: (() => void)[] = [];
    public raised: ConflictHandlers[] = [];
    public cleared: string[] = [];

    public changedOnDisk(_identity: unknown, reload: () => void): void {
      this.cleanReloads.push(reload);
    }

    public raise(_identity: unknown, actions: ConflictHandlers): void {
      this.raised.push(actions);
    }

    public clear(tabId: string): void {
      this.cleared.push(tabId);
    }
  }

  let documents: BinaryDocuments;
  let watch: FakeWatch;
  let conflicts: FakeConflicts;
  let disk: FakeDisk;
  let tab: Tab;

  beforeEach(async (): Promise<void> => {
    watch = new FakeWatch();
    conflicts = new FakeConflicts();
    disk = new FakeDisk();
    TestBed.configureTestingModule({
      providers: [
        { provide: FileWatch, useValue: watch },
        { provide: FileConflicts, useValue: conflicts },
        { provide: Workspace, useValue: disk },
      ],
    });
    documents = TestBed.inject(BinaryDocuments);
    tab = documents.open('/fixture/app.bin');
    await documents.get(tab.id)?.whenReady();
  });

  it('externalChange_toACleanDocument_offersToReload', async () => {
    watch.listener?.();
    disk.size = 10;

    conflicts.cleanReloads[0]?.();

    await vi.waitFor((): void => {
      expect(documents.get(tab.id)?.size()).toBe(10);
    });
    expect(conflicts.raised).toEqual([]);
  });

  it('externalChange_toADirtyDocument_raisesAConflictThatKeepsOrReloads', async () => {
    const entry: BinaryDocumentEntry | undefined = documents.get(tab.id);
    entry?.overwrite(0, 9);

    watch.listener?.();
    conflicts.raised[0]?.keep();
    expect(entry?.byteAt(0)).toBe(9);

    conflicts.raised[0]?.reload();

    await vi.waitFor((): void => {
      expect(entry?.dirty()).toBe(false);
    });
  });

  it('theSavesOwnEcho_isNotAnExternalChange', async () => {
    const entry: BinaryDocumentEntry | undefined = documents.get(tab.id);
    entry?.overwrite(0, 9);
    await documents.save(tab.id);

    watch.listener?.();

    expect(conflicts.cleanReloads).toEqual([]);
    expect(conflicts.raised).toEqual([]);
  });

  it('release_stopsWatchingAndClearsAConflict', () => {
    documents.release(tab.id);

    expect(watch.disposed).toBe(1);
    expect(conflicts.cleared).toEqual([tab.id]);
    expect(documents.get(tab.id)).toBeUndefined();
    watch.listener?.();
    expect(conflicts.cleanReloads).toEqual([]);
  });

  it('save_whenItFails_reportsFalseSoACloseIsAborted', async () => {
    documents.get(tab.id)?.overwrite(0, 9);
    disk.writeResult = false;

    expect(await documents.save(tab.id)).toBe(false);
    expect(documents.dirtyDocumentsFor(tab.id)).toHaveLength(1);
  });

  it('dirtyDocumentsFor_ignoresOtherTabs', () => {
    documents.get(tab.id)?.overwrite(0, 9);

    expect(documents.dirtyDocumentsFor('elsewhere')).toEqual([]);
  });

  it('open_namesATabFromEitherSeparator', () => {
    expect(documents.open('C:\\fixture\\win.bin').title).toBe('win.bin');
  });
});
