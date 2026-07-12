import { TestBed } from '@angular/core/testing';
import {
  DELETE_BINARY_BYTES,
  INSERT_BINARY_BYTES,
  PATCH_BINARY_BYTES,
  READ_BINARY_BYTES,
  READ_BINARY_DISASSEMBLY,
  READ_BINARY_OVERVIEW,
  READ_BINARY_SELECTION,
} from '@shared/api/ai-types';
import { DecodedInstruction } from '@shared/api/binary-channels';
import { AiCapability, AiRuntime } from '@shared/angular/services/ai-runtime/ai-runtime';
import {
  BinaryDocumentEntry,
  BinaryDocuments,
  BinarySelection,
} from '../binary-document/binary-document';
import { BinaryFormat } from '../binary-format/binary-format';
import { BinaryAgentCapabilities } from './binary-agent-capabilities';

/**
 * The configurable state a fake binary document is built from.
 */
interface FakeDocumentState {
  /**
   * Gets the cursor offset, or null when there is no cursor.
   */
  readonly cursor: number | null;

  /**
   * Gets the byte selection, or null when nothing is selected.
   */
  readonly selection: BinarySelection | null;

  /**
   * Gets the file size in bytes.
   */
  readonly size: number;

  /**
   * Gets whether the document has unsaved edits.
   */
  readonly dirty: boolean;

  /**
   * Gets the sniffed container format.
   */
  readonly format: BinaryFormat;

  /**
   * Gets the file's bytes, served to `readBytes` reads.
   */
  readonly bytes: readonly number[];

  /**
   * Gets the instructions `disassembleRange` decodes, or null when disassembly is unsupported.
   */
  readonly instructions: readonly DecodedInstruction[] | null;

  /**
   * Gets whether `patch` accepts the write.
   */
  readonly patchOk: boolean;

  /**
   * Gets whether `insertBytes` and `removeBytes` accept the edit.
   */
  readonly resizeOk: boolean;
}

/**
 * A fake binary document together with the calls the capabilities made against it.
 */
interface FakeDocument {
  /**
   * Gets the duck-typed document entry handed to the capabilities.
   */
  readonly entry: BinaryDocumentEntry;

  /**
   * Gets the byte-range reads the capabilities requested.
   */
  readonly reads: { offset: number; length: number }[];

  /**
   * Gets the byte patches the capabilities applied.
   */
  readonly patches: { offset: number; values: readonly number[] }[];

  /**
   * Gets the byte insertions the capabilities applied.
   */
  readonly inserts: { offset: number; values: readonly number[] }[];

  /**
   * Gets the byte deletions the capabilities applied.
   */
  readonly deletes: { offset: number; count: number }[];
}

/**
 * Builds a fake binary document exposing just the surface the capabilities consume, recording the
 * reads and patches made against it.
 * @param overrides The state fields to override.
 * @returns Returns the fake document and its recorded calls.
 */
function fakeDocument(overrides: Partial<FakeDocumentState> = {}): FakeDocument {
  const state: FakeDocumentState = {
    cursor: null,
    selection: null,
    size: 64,
    dirty: false,
    format: { kind: 'pe', architecture: 'x64', managed: false },
    bytes: [],
    instructions: [],
    patchOk: true,
    resizeOk: true,
    ...overrides,
  };
  const reads: { offset: number; length: number }[] = [];
  const patches: { offset: number; values: readonly number[] }[] = [];
  const inserts: { offset: number; values: readonly number[] }[] = [];
  const deletes: { offset: number; count: number }[] = [];
  const entry: BinaryDocumentEntry = {
    path: '/ws/blob.bin',
    fileName: 'blob.bin',
    whenReady: (): Promise<void> => Promise.resolve(),
    format: (): BinaryFormat => state.format,
    cursor: (): number | null => state.cursor,
    selection: (): BinarySelection | null => state.selection,
    size: (): number => state.size,
    dirty: (): boolean => state.dirty,
    readBytes: (offset: number, length: number): Promise<number[]> => {
      reads.push({ offset, length });
      return Promise.resolve([...state.bytes.slice(offset, offset + length)]);
    },
    disassembleRange: (): Promise<readonly DecodedInstruction[] | null> =>
      Promise.resolve(state.instructions),
    patch: (offset: number, values: readonly number[]): Promise<boolean> => {
      patches.push({ offset, values });
      return Promise.resolve(state.patchOk);
    },
    insertBytes: (offset: number, values: readonly number[]): Promise<boolean> => {
      inserts.push({ offset, values });
      return Promise.resolve(state.resizeOk);
    },
    removeBytes: (offset: number, count: number): Promise<boolean> => {
      deletes.push({ offset, count });
      return Promise.resolve(state.resizeOk);
    },
  } as unknown as BinaryDocumentEntry;
  return { entry, reads, patches, inserts, deletes };
}

describe('BinaryAgentCapabilities', () => {
  let registered: Map<string, AiCapability>;
  let documents: Map<string, BinaryDocumentEntry>;

  /**
   * Invokes a registered capability with an input carrying the fake tab identifier.
   * @param name The capability name.
   * @param input The extra input fields, merged over the tab identifier.
   * @returns Returns the awaited capability result.
   */
  async function run(name: string, input: Record<string, unknown> = {}): Promise<unknown> {
    return await registered.get(name)?.({ tabId: 'tab-1', ...input });
  }

  beforeEach(() => {
    registered = new Map<string, AiCapability>();
    documents = new Map<string, BinaryDocumentEntry>();
    const runtimeStub: Pick<AiRuntime, 'registerCapability'> = {
      registerCapability: (name: string, handler: AiCapability): (() => void) => {
        registered.set(name, handler);
        return (): void => undefined;
      },
    };
    const documentsStub: Pick<BinaryDocuments, 'get'> = {
      get: (tabId: string): BinaryDocumentEntry | undefined => documents.get(tabId),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: AiRuntime, useValue: runtimeStub },
        { provide: BinaryDocuments, useValue: documentsStub },
      ],
    });
    // Instantiate the service so it registers its capabilities.
    TestBed.inject(BinaryAgentCapabilities);
  });

  it('constructor_whenInstantiated_registersTheSevenBinaryCapabilities', () => {
    expect(Array.from(registered.keys()).sort()).toEqual(
      [
        DELETE_BINARY_BYTES,
        INSERT_BINARY_BYTES,
        PATCH_BINARY_BYTES,
        READ_BINARY_BYTES,
        READ_BINARY_DISASSEMBLY,
        READ_BINARY_OVERVIEW,
        READ_BINARY_SELECTION,
      ].sort(),
    );
  });

  it('insert_parsesHexAndInsertsAtTheOffset', async () => {
    const fake: FakeDocument = fakeDocument({ size: 8 });
    documents.set('tab-1', fake.entry);

    const result: unknown = await run(INSERT_BINARY_BYTES, { offset: 4, bytes: '0xDE AD' });

    expect(fake.inserts).toEqual([{ offset: 4, values: [0xde, 0xad] }]);
    expect((result as { ok: boolean; text: string }).ok).toBe(true);
    expect((result as { text: string }).text).toContain('shifted by +2');
  });

  it('insert_whenOffsetOutOfBounds_reportsTheFailure', async () => {
    const fake: FakeDocument = fakeDocument({ size: 8, resizeOk: false });
    documents.set('tab-1', fake.entry);

    const result: unknown = await run(INSERT_BINARY_BYTES, { offset: 99, bytes: 'ff' });

    expect((result as { ok: boolean; text: string }).ok).toBe(false);
    expect((result as { text: string }).text).toContain('outside the file');
  });

  it('insert_whenBytesMalformed_rejectsWithoutEditing', async () => {
    const fake: FakeDocument = fakeDocument();
    documents.set('tab-1', fake.entry);

    const result: unknown = await run(INSERT_BINARY_BYTES, { offset: 0, bytes: 'zz' });

    expect(fake.inserts).toEqual([]);
    expect((result as { ok: boolean }).ok).toBe(false);
  });

  it('delete_removesTheRangeAndWarnsAboutTheShift', async () => {
    const fake: FakeDocument = fakeDocument({ size: 32 });
    documents.set('tab-1', fake.entry);

    const result: unknown = await run(DELETE_BINARY_BYTES, { offset: 8, length: 4 });

    expect(fake.deletes).toEqual([{ offset: 8, count: 4 }]);
    expect((result as { ok: boolean; text: string }).ok).toBe(true);
    expect((result as { text: string }).text).toContain('shifted by -4');
  });

  it('delete_whenLengthNotPositive_rejectsWithoutEditing', async () => {
    const fake: FakeDocument = fakeDocument();
    documents.set('tab-1', fake.entry);

    const result: unknown = await run(DELETE_BINARY_BYTES, { offset: 0, length: 0 });

    expect(fake.deletes).toEqual([]);
    expect((result as { ok: boolean }).ok).toBe(false);
  });

  it('delete_whenRangeOutOfBounds_reportsTheFailure', async () => {
    const fake: FakeDocument = fakeDocument({ size: 8, resizeOk: false });
    documents.set('tab-1', fake.entry);

    const result: unknown = await run(DELETE_BINARY_BYTES, { offset: 6, length: 4 });

    expect((result as { ok: boolean; text: string }).ok).toBe(false);
    expect((result as { text: string }).text).toContain('outside the file');
  });

  it('overview_whenTabUnknown_reportsUnavailable', async () => {
    expect(await run(READ_BINARY_OVERVIEW)).toEqual({ available: false, text: '' });
  });

  it('overview_describesTheFileFormatCursorAndSelection', async () => {
    documents.set(
      'tab-1',
      fakeDocument({ cursor: 16, selection: { start: 2, end: 6 }, size: 64 }).entry,
    );
    const result: { available: boolean; text: string } = (await run(READ_BINARY_OVERVIEW)) as {
      available: boolean;
      text: string;
    };
    expect(result.available).toBe(true);
    expect(result.text).toContain('File: blob.bin (/ws/blob.bin)');
    expect(result.text).toContain('Size: 64 bytes');
    expect(result.text).toContain('Format: PE · x64');
    expect(result.text).toContain('Disassembly: available (x64)');
    expect(result.text).toContain('Cursor: 0x10 (16)');
    expect(result.text).toContain('Selection: 0x2–0x6 (4 bytes)');
    expect(result.text).toContain('Unsaved edits: no');
  });

  it('readBytes_rendersAHexAndAsciiDumpOfTheRange', async () => {
    documents.set('tab-1', fakeDocument({ size: 5, bytes: [0x48, 0x65, 0x6c, 0x6c, 0x6f] }).entry);
    const result: { available: boolean; text: string } = (await run(READ_BINARY_BYTES, {
      offset: 0,
      length: 5,
    })) as { available: boolean; text: string };
    expect(result.available).toBe(true);
    expect(result.text.startsWith('00000000  48 65 6C 6C 6F')).toBe(true);
    expect(result.text).toContain('|Hello|');
    expect(result.text).toContain('(5 byte(s) from 0x0; file size 5 bytes.)');
  });

  it('readBytes_clampsTheRequestedLengthToTheReadCap', async () => {
    const fake: FakeDocument = fakeDocument({ size: 1, bytes: [0x00] });
    documents.set('tab-1', fake.entry);
    await run(READ_BINARY_BYTES, { offset: 0, length: 10000 });
    expect(fake.reads).toEqual([{ offset: 0, length: 4096 }]);
  });

  it('readSelection_whenNothingIsSelected_saysSo', async () => {
    documents.set('tab-1', fakeDocument({ selection: null }).entry);
    expect(await run(READ_BINARY_SELECTION)).toEqual({
      available: true,
      text: 'Nothing is selected.',
    });
  });

  it('readDisassembly_listsTheDecodedInstructions', async () => {
    documents.set(
      'tab-1',
      fakeDocument({
        instructions: [
          { startOffset: 16, byteLength: 3, mnemonic: 'mov', operands: 'rax, rbx', raw: [0, 0, 0] },
          { startOffset: 19, byteLength: 1, mnemonic: 'ret', operands: '', raw: [0] },
        ],
      }).entry,
    );
    expect(await run(READ_BINARY_DISASSEMBLY, { offset: 16, length: 4 })).toEqual({
      available: true,
      text: '00000010  mov rax, rbx\n00000013  ret',
    });
  });

  it('readDisassembly_whenTheFormatIsUnsupported_explains', async () => {
    documents.set('tab-1', fakeDocument({ instructions: null, format: { kind: 'unknown' } }).entry);
    const result: { available: boolean; text: string } = (await run(READ_BINARY_DISASSEMBLY, {
      offset: 0,
      length: 16,
    })) as { available: boolean; text: string };
    expect(result.available).toBe(true);
    expect(result.text).toContain('Disassembly is not available for this format (Binary).');
  });

  it('patch_whenTheHexOrOffsetIsMalformed_rejectsWithoutWriting', async () => {
    const fake: FakeDocument = fakeDocument();
    documents.set('tab-1', fake.entry);
    const badHex: { ok: boolean } = (await run(PATCH_BINARY_BYTES, {
      offset: 0,
      bytes: 'zz',
    })) as { ok: boolean };
    const missingOffset: { ok: boolean } = (await run(PATCH_BINARY_BYTES, { bytes: '4d' })) as {
      ok: boolean;
    };
    expect(badHex.ok).toBe(false);
    expect(missingOffset.ok).toBe(false);
    expect(fake.patches).toEqual([]);
  });

  it('patch_parsesTheHexStringAndOverwritesViaTheDocument', async () => {
    const fake: FakeDocument = fakeDocument();
    documents.set('tab-1', fake.entry);
    const result: { ok: boolean; text: string } = (await run(PATCH_BINARY_BYTES, {
      offset: 3,
      bytes: '0x4D, 5a',
    })) as { ok: boolean; text: string };
    expect(result.ok).toBe(true);
    expect(result.text).toContain('Overwrote 2 byte(s) at 0x3');
    expect(fake.patches).toEqual([{ offset: 3, values: [0x4d, 0x5a] }]);
  });

  it('patch_whenTheDocumentRejectsTheRange_reportsTheFailure', async () => {
    const fake: FakeDocument = fakeDocument({ patchOk: false, size: 4 });
    documents.set('tab-1', fake.entry);
    const result: { ok: boolean; text: string } = (await run(PATCH_BINARY_BYTES, {
      offset: 100,
      bytes: 'ff',
    })) as { ok: boolean; text: string };
    expect(result.ok).toBe(false);
    expect(result.text).toContain('the range is outside the file (size 4 bytes)');
  });
});
