import {
  computed,
  effect,
  EffectRef,
  inject,
  Injector,
  Service,
  signal,
  Signal,
  WritableSignal,
} from '@angular/core';
import { AssembleResult, DecodedInstruction } from '@shared/api/binary-channels';
import { CodeListing, listingFromInstructions } from '@shared/api/code-listing';
import { DecoderDescription } from '@shared/api/decoder-protocol';
import { BinaryChunk, BinaryPatch } from '@shared/api/workspace-channels';
import { FileConflicts } from '@shared/angular/services/file-conflicts/file-conflicts';
import { FileWatch } from '@shared/angular/services/file-watch/file-watch';
import { Log } from '@shared/angular/services/log/log';
import { Tab } from '@shared/angular/services/tabs/tab';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import {
  UnsavedDocument,
  UnsavedWorkSource,
} from '@shared/angular/services/unsaved-work/unsaved-work';
import { Workspace } from '@shared/angular/services/workspace/workspace';
import { PieceRun, PieceTable, PieceTableSnapshot } from './binary-piece-table';
import { BinaryDisassembly } from '../binary-disassembly/binary-disassembly';
import { BinaryAssembly } from '../binary-assembly/binary-assembly';
import {
  BinaryFormat,
  codeOffset,
  disassemblyArchitecture,
  formatKey,
  sniffFormat,
} from '../binary-format/binary-format';

/**
 * Specifies the largest file that will be sent whole to a decoder that needs it all.
 *
 * A metadata decoder cannot work from a window, so the alternative to sending everything is showing
 * nothing. Assemblies are small; this is a guard against a pathological file rather than a limit
 * anyone should meet.
 */
const MAX_WHOLE_FILE_DECODE: number = 64 * 1024 * 1024;

/**
 * Specifies the largest companion file that will be read and sent alongside a decode. A portable PDB
 * for a very large assembly is a few megabytes; this is a guard, not a limit anyone should meet.
 */
const MAX_COMPANION_BYTES: number = 32 * 1024 * 1024;

/**
 * Specifies the size, in bytes, of each block fetched and cached from a file. A multiple of the row
 * width so a block boundary never splits a rendered row. Larger than a typical viewport so scrolling
 * within a block needs no further reads.
 */
const BLOCK_SIZE: number = 64 * 1024;

/**
 * Specifies the largest number of file blocks kept resident in the cache. Beyond this the least
 * recently visited blocks are evicted, so scrolling through a very large file bounds memory (this cap
 * is ~4 MiB) rather than accumulating every block ever read. Evicted blocks re-fetch on demand.
 */
const MAX_RESIDENT_BLOCKS: number = 64;

/**
 * Specifies how long (in milliseconds) viewport-driven disassembly requests are debounced, so a
 * request is issued only once scrolling settles rather than on every intermediate frame.
 */
const DISASSEMBLY_DEBOUNCE_MS: number = 120;

/**
 * Specifies how many bytes pad each side of a disassembly range, so an instruction straddling either
 * edge decodes (the padding instructions are then filtered out). A little over the longest x86
 * instruction.
 */
const DISASSEMBLY_PAD: number = 16;

/**
 * Specifies the window, in milliseconds, within which a file-watch notification after the document's
 * own save is treated as that save's echo rather than an external change.
 */
const SAVE_ECHO_WINDOW_MS: number = 2000;

/**
 * Specifies the largest number of disassembled ranges cached before the cache is cleared, bounding
 * memory over a long editing session.
 */
const MAX_DISASSEMBLY_CACHE: number = 128;

/**
 * Describes a contiguous byte selection within a binary document, as a half-open range `[start, end)`.
 */
export interface BinarySelection {
  /**
   * Gets the offset of the first selected byte.
   */
  readonly start: number;

  /**
   * Gets the offset one past the last selected byte.
   */
  readonly end: number;
}

/**
 * Represents one open binary document: the file it is bound to, its reactive viewport state (size,
 * row width, cursor, selection), and a block cache filled on demand from the main process so only the
 * bytes the user looks at are ever read. Rendering reads bytes through {@link byteAt} and re-runs when
 * {@link loadedVersion} changes; the view drives {@link ensureRange} as its viewport moves.
 */
export class BinaryDocumentEntry {
  /**
   * Holds the block cache, keyed by block index (offset / {@link BLOCK_SIZE}).
   */
  private readonly blocks: Map<number, Uint8Array> = new Map<number, Uint8Array>();

  /**
   * Holds the in-flight fetch for each block index, so a block is never fetched twice and callers can
   * await a block's arrival (see {@link readBytes}).
   */
  private readonly blockFetches: Map<number, Promise<void>> = new Map<number, Promise<void>>();

  /**
   * Holds the logical size in bytes: the original file size adjusted by any inserts and deletes.
   */
  public readonly size: WritableSignal<number> = signal<number>(0);

  /**
   * Holds the number of bytes shown per row.
   */
  public readonly bytesPerRow: WritableSignal<number> = signal<number>(16);

  /**
   * Holds the cursor's byte offset, or null when there is no cursor.
   */
  public readonly cursor: WritableSignal<number | null> = signal<number | null>(null);

  /**
   * Holds the current selection, or null when nothing is selected.
   */
  public readonly selection: WritableSignal<BinarySelection | null> =
    signal<BinarySelection | null>(null);

  /**
   * Holds a counter bumped whenever a block arrives, so byte-reading computeds re-run as data loads.
   */
  public readonly loadedVersion: WritableSignal<number> = signal<number>(0);

  /**
   * Holds the edit model: a piece table over the unchanging original file plus an append-only added
   * buffer, so overwrite, insert, and delete are all cheap and reads stay windowed.
   */
  private readonly table: PieceTable = new PieceTable();

  /**
   * Holds the original file's size in bytes, learned from the first read and updated when a structural
   * save rewrites the file.
   */
  private originalSize: number = 0;

  /**
   * Holds whether the original size has been learned (and the piece table initialised).
   */
  private initialized: boolean = false;

  /**
   * Holds the last viewport range the view asked to load, so a structural save can re-fetch it after
   * the block cache is dropped.
   */
  private lastRange: { offset: number; length: number } | null = null;

  /**
   * Holds when the document last wrote itself to disk, so the file-watch echo of the application's
   * own save is not mistaken for an external change (which would needlessly reload — or, had the user
   * already typed again, raise a conflict against their own save).
   */
  private lastSavedAt: number = 0;

  /**
   * Holds the undo stack of pre-edit snapshots, most recent last.
   */
  private undoStack: PieceTableSnapshot[] = [];

  /**
   * Holds the redo stack of snapshots undone edits can be reapplied from.
   */
  private redoStack: PieceTableSnapshot[] = [];

  /**
   * Holds a counter bumped whenever an edit is made or saved, so byte-reading computeds re-run.
   */
  public readonly editsVersion: WritableSignal<number> = signal<number>(0);

  /**
   * Holds whether the document has unsaved edits.
   */
  public readonly dirty: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds whether typing inserts bytes (true) or overwrites them (false, the default).
   */
  public readonly insertMode: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds whether there is an edit to undo.
   */
  public readonly canUndo: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds whether there is an undone edit to redo.
   */
  public readonly canRedo: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Gets a combined data version that changes when loaded bytes or edits change, so the editor
   * re-renders on either.
   */
  public readonly dataVersion: Signal<number> = computed(
    (): number => this.loadedVersion() + this.editsVersion(),
  );

  /**
   * Holds the sniffed container format and architecture, resolved once the first block loads.
   */
  public readonly format: WritableSignal<BinaryFormat> = signal<BinaryFormat>({ kind: 'unknown' });

  /**
   * Holds the file offset where code begins (entry point or first code section), or null when it
   * cannot be determined. Drives the ribbon's "Go to Code" action.
   */
  public readonly codeOffset: WritableSignal<number | null> = signal<number | null>(null);

  /**
   * Holds the decoded instructions for the current viewport range, or an empty list when the format is
   * not natively disassemblable (managed/JVM/unknown) or none has been loaded yet.
   */
  public readonly instructions: WritableSignal<readonly DecodedInstruction[]> = signal<
    readonly DecodedInstruction[]
  >([]);

  /**
   * Holds the decoded instructions as a {@link CodeListing}, which is the contract the assembly panel
   * consumes and the shape every decoder returns.
   *
   * Native disassembly is flat and offset-keyed, so it becomes a listing with one section — which is
   * exactly why the listing contract wraps {@link DecodedInstruction} rather than replacing it. When
   * the native path moves out of core into a decoder plugin, the producer changes and the panel does
   * not.
   */
  public readonly listing: Signal<CodeListing | null> = computed((): CodeListing | null => {
    // An installed decoder plugin wins: it is the direction of travel, and it can decode formats the
    // in-core path never could. The native fallback below exists only until that path is removed.
    const decoded: CodeListing | null = this.pluginListing();
    if (decoded !== null) {
      return decoded;
    }
    const architecture: string | null = disassemblyArchitecture(this.format());
    const instructions: readonly DecodedInstruction[] = this.instructions();
    if (architecture === null || instructions.length === 0) {
      return null;
    }
    return listingFromInstructions(instructions, architecture, this.path);
  });

  /**
   * Holds the listing an installed decoder plugin returned for the current range, or null when none is
   * installed for this format or it has not answered yet.
   */
  private readonly pluginListing: WritableSignal<CodeListing | null> = signal<CodeListing | null>(
    null,
  );

  /**
   * Holds the edit version whose whole-file decode has been requested, so scrolling a managed assembly
   * does not re-send the entire file on every viewport movement. Reset to -1 on failure so a later
   * attempt retries.
   */
  private wholeFileDecodeVersion: number = -1;

  /**
   * Holds disassembled ranges keyed by `arch:offset:length`, so re-visiting a range does not re-invoke
   * the disassembler.
   */
  private readonly disassemblyCache: Map<string, readonly DecodedInstruction[]> = new Map<
    string,
    readonly DecodedInstruction[]
  >();

  /**
   * Holds the pending debounced disassembly timer, or null when none is scheduled.
   */
  private disassemblyTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Tracks the latest disassembly request, so a slow earlier request never overwrites a newer result.
   */
  private disassemblyToken: number = 0;

  /**
   * Holds a counter bumped by {@link reveal} so the view scrolls to {@link revealOffset} on request.
   */
  public readonly revealVersion: WritableSignal<number> = signal<number>(0);

  /**
   * Holds the byte offset the view should scroll into view on the next reveal, or null when none.
   */
  public revealOffset: number | null = null;

  /**
   * Initializes a new instance of the {@link BinaryDocumentEntry} class.
   * @param tabId The identifier of the owning tab.
   * @param path The absolute path of the file.
   * @param fileName The file's base name.
   * @param workspace The workspace client used to read byte windows from the main process.
   * @param disassembly The disassembly client used to decode instructions.
   * @param assembly The assembly client used to assemble instructions the agent writes.
   */
  public constructor(
    public readonly tabId: string,
    public readonly path: string,
    public readonly fileName: string,
    private readonly workspace: Workspace,
    private readonly disassembly: BinaryDisassembly,
    private readonly assembly: BinaryAssembly,
  ) {}

  /**
   * Fetches the first block so the file size becomes known and the first screen has data.
   */
  public prime(): void {
    void this.ensureBlock(0);
  }

  /**
   * Moves the cursor to an offset, selects that byte, and asks the view to scroll it into view. Used
   * by the ribbon's go-to-offset action.
   * @param offset The byte offset to reveal.
   */
  public reveal(offset: number): void {
    const clamped: number = Math.max(0, Math.min(offset, Math.max(0, this.size() - 1)));
    this.cursor.set(clamped);
    this.selection.set({ start: clamped, end: clamped + 1 });
    this.ensureRange(clamped, 1);
    this.revealOffset = clamped;
    this.revealVersion.update((version: number): number => version + 1);
  }

  /**
   * Gets the byte at an offset, or null when its block has not loaded yet or the offset is past the
   * end of the file. Reactive on {@link loadedVersion}, so callers re-run when the block arrives.
   * @param offset The absolute byte offset.
   * @returns Returns the byte value (0–255), or null when unavailable.
   */
  public byteAt(offset: number): number | null {
    if (!this.initialized) {
      return this.cachedByteAt(offset);
    }
    const location: { original: number } | { value: number } | null = this.table.locate(offset);
    if (location === null) {
      return null;
    }
    return 'value' in location ? location.value : this.cachedByteAt(location.original);
  }

  /**
   * Overwrites the byte at an offset with a new value (leaving the file's length unchanged).
   * @param offset The logical byte offset to overwrite.
   * @param value The new byte value (0–255).
   */
  public overwrite(offset: number, value: number): void {
    if (!this.initialized || offset < 0 || offset >= this.size()) {
      return;
    }
    this.applyEdit((): void => this.table.replace(offset, 1, [value & 0xff]));
  }

  /**
   * Inserts a byte before an offset, growing the document by one.
   * @param offset The logical offset to insert before (0 to the end of the document).
   * @param value The byte value (0–255) to insert.
   */
  public insertByte(offset: number, value: number): void {
    if (!this.initialized || offset < 0 || offset > this.size()) {
      return;
    }
    this.applyEdit((): void => this.table.replace(offset, 0, [value & 0xff]));
  }

  /**
   * Deletes a run of bytes, shrinking the document.
   * @param offset The first logical offset to delete.
   * @param count The number of bytes to delete.
   */
  public deleteBytes(offset: number, count: number): void {
    if (!this.initialized || offset < 0 || offset >= this.size() || count <= 0) {
      return;
    }
    this.applyEdit((): void => this.table.replace(offset, count, []));
  }

  /**
   * Undoes the most recent edit, if any.
   */
  public undo(): void {
    if (this.undoStack.length === 0) {
      return;
    }
    this.redoStack.push(this.table.snapshot());
    this.table.restore(this.undoStack.pop()!);
    this.afterMutation();
  }

  /**
   * Reapplies the most recently undone edit, if any.
   */
  public redo(): void {
    if (this.redoStack.length === 0) {
      return;
    }
    this.undoStack.push(this.table.snapshot());
    this.table.restore(this.redoStack.pop()!);
    this.afterMutation();
  }

  /**
   * Applies a piece-table edit within an undo transaction: it records the pre-edit state, runs the
   * edit, discards the redo history, and refreshes the reactive state.
   * @param edit The edit to apply to the table.
   */
  private applyEdit(edit: () => void): void {
    this.undoStack.push(this.table.snapshot());
    this.redoStack = [];
    edit();
    this.afterMutation();
  }

  /**
   * Refreshes the reactive state after the piece table changes: logical size, dirty flag, undo/redo
   * availability, and the data version that re-renders the grid and re-runs disassembly.
   */
  private afterMutation(): void {
    this.size.set(this.table.length());
    this.dirty.set(!this.table.isPristine());
    this.canUndo.set(this.undoStack.length > 0);
    this.canRedo.set(this.redoStack.length > 0);
    this.editsVersion.update((version: number): number => version + 1);
  }

  /**
   * Saves the pending edits. Overwrite-only edits are written in place (every offset still maps to its
   * file offset); once bytes have been inserted or deleted, the file is rewritten by streaming the
   * pieces in the main process. Either way the model then matches the on-disk file and dirty clears.
   * @returns Returns true when the file was written (or there was nothing to write), false on failure.
   */
  public async save(): Promise<boolean> {
    if (!this.dirty()) {
      return true;
    }
    const written: boolean = this.table.isStructural()
      ? await this.saveByRewrite()
      : await this.saveInPlace();
    if (!written) {
      return false;
    }
    this.lastSavedAt = Date.now();
    this.undoStack = [];
    this.redoStack = [];
    this.dirty.set(false);
    this.canUndo.set(false);
    this.canRedo.set(false);
    this.editsVersion.update((version: number): number => version + 1);
    return true;
  }

  /**
   * Saves overwrite-only edits in place, then folds them into the block cache so the cache reports the
   * saved bytes and resets the table to the (same-sized) original.
   * @returns Returns true when the write succeeded.
   */
  private async saveInPlace(): Promise<boolean> {
    const runs: PieceRun[] = this.table.overwritePatches();
    const patches: BinaryPatch[] = runs.map((run: PieceRun): BinaryPatch => ({
      offset: run.offset,
      bytes: run.bytes,
    }));
    if (!(await this.workspace.writeBytes(this.path, patches))) {
      return false;
    }
    for (const run of runs) {
      run.bytes.forEach((value: number, index: number): void =>
        this.applyToCache(run.offset + index, value),
      );
    }
    this.table.reset();
    return true;
  }

  /**
   * Determines whether the document wrote itself to disk within the given window, so the watch echo
   * of the application's own save can be told apart from an external change.
   * @param withinMs The window, in milliseconds.
   * @returns Returns true when the document saved within the window.
   */
  public recentlySaved(withinMs: number): boolean {
    return Date.now() - this.lastSavedAt < withinMs;
  }

  /**
   * Reloads the document from the file after it changed on disk outside the application: pending
   * edits and their undo history are discarded, the stale block cache is dropped, and the first block
   * plus the visible range are re-fetched. The first read re-learns the file's (possibly changed)
   * size before the model resets to it, so the grid never sizes itself from a stale length.
   * @returns Returns a promise that resolves once the reload has been applied.
   */
  public async reloadFromDisk(): Promise<void> {
    const chunk: BinaryChunk | null = await this.workspace.readBytes(this.path, 0, BLOCK_SIZE);
    if (chunk === null) {
      return;
    }
    this.blocks.clear();
    this.blocks.set(0, chunk.bytes);
    this.originalSize = chunk.size;
    this.table.reset(chunk.size);
    this.initialized = true;
    this.undoStack = [];
    this.redoStack = [];
    this.afterMutation();
    // Clamp the cursor and selection into the (possibly shrunken) file.
    const cursor: number | null = this.cursor();
    if (cursor !== null && cursor >= this.size()) {
      this.cursor.set(this.size() > 0 ? this.size() - 1 : null);
      this.selection.set(null);
    }
    this.loadedVersion.update((version: number): number => version + 1);
    if (this.lastRange !== null) {
      this.ensureRange(this.lastRange.offset, this.lastRange.length);
    }
  }

  /**
   * Saves structural edits by streaming the pieces to a rewritten file in the main process, then drops
   * the now-stale block cache, resets the table to the new file, and re-fetches the visible range.
   * @returns Returns true when the rewrite succeeded.
   */
  private async saveByRewrite(): Promise<boolean> {
    if (
      !(await this.workspace.writePieces(this.path, this.table.spans(), this.table.addedBytes()))
    ) {
      return false;
    }
    this.originalSize = this.table.length();
    this.blocks.clear();
    this.table.reset(this.originalSize);
    this.loadedVersion.update((version: number): number => version + 1);
    void this.ensureBlock(0);
    if (this.lastRange !== null) {
      this.ensureRange(this.lastRange.offset, this.lastRange.length);
    }
    return true;
  }

  /**
   * Loads disassembly for a byte range (the visible viewport), debounced so it fires once scrolling
   * settles, and cached so re-visiting a range does not re-invoke the disassembler. Sets an empty list
   * immediately when the format is not natively disassemblable.
   * @param offset The first byte of the range.
   * @param length The number of bytes in the range.
   */
  public loadDisassembly(offset: number, length: number): void {
    const architecture: string | null = disassemblyArchitecture(this.format());
    const formatSlot: string | null = formatKey(this.format());
    if (length <= 0 || (architecture === null && formatSlot === null)) {
      this.instructions.set([]);
      this.pluginListing.set(null);
      return;
    }

    // The edits version is part of the key so an overwrite invalidates the cached decode and the range
    // re-disassembles from the edited bytes rather than the stale result.
    const key: string = `${architecture ?? formatSlot ?? ''}:${offset}:${length}:${this.editsVersion()}`;
    const cached: readonly DecodedInstruction[] | undefined = this.disassemblyCache.get(key);
    if (architecture !== null && cached !== undefined) {
      this.instructions.set(cached);
      return;
    }
    if (this.disassemblyTimer !== null) {
      clearTimeout(this.disassemblyTimer);
    }
    // One token and one debounce covers both paths: a decoder plugin and the in-core disassembler are
    // asked about the same window, and a result that arrives after the viewport has moved on is
    // discarded whichever produced it.
    const token: number = (this.disassemblyToken += 1);
    this.disassemblyTimer = setTimeout((): void => {
      const window: { bytes: Uint8Array; base: number } | null = this.disassemblyWindow(
        offset,
        length,
      );
      if (window === null) {
        if (token === this.disassemblyToken) {
          this.instructions.set([]);
        }
        return;
      }
      // A decoder plugin is asked whenever the format has a key — and for a format the in-core path
      // cannot handle at all, it is the only thing asked.
      if (formatSlot !== null) {
        void this.decodeWithPlugin(formatSlot, window, token);
      }
      if (architecture === null) {
        return;
      }
      void this.disassembly
        .disassemble(window.bytes, window.base, offset, offset + length, architecture)
        .then((result: readonly DecodedInstruction[]): void => {
          if (this.disassemblyCache.size >= MAX_DISASSEMBLY_CACHE) {
            const oldest: string | undefined = this.disassemblyCache.keys().next().value;
            if (oldest !== undefined) {
              this.disassemblyCache.delete(oldest);
            }
          }
          this.disassemblyCache.set(key, result);
          if (token === this.disassemblyToken) {
            this.instructions.set(result);
          }
        });
    }, DISASSEMBLY_DEBOUNCE_MS);
  }

  /**
   * Decodes a range with a decoder plugin, sending the whole file when the decoder needs it.
   *
   * A metadata format cannot be read from a viewport window at all — the tables that locate a method
   * body are spread across the file — so those decoders are given everything, once, rather than a
   * slice per scroll. The result is cached against the edit version, so scrolling a managed assembly
   * costs one decode rather than one per movement.
   * @param format The canonical format key.
   * @param window The padded viewport window, used by windowed decoders.
   * @param token The request token, so a result arriving after the viewport moved on is discarded.
   */
  private async decodeWithPlugin(
    format: string,
    window: { bytes: Uint8Array; base: number },
    token: number,
  ): Promise<void> {
    const info: DecoderDescription | null = await this.disassembly.decoderInfo(format);
    if (info === null) {
      return;
    }
    if (!info.requiresWholeFile) {
      const listing: CodeListing | null = await this.disassembly.decodeListing(
        format,
        window.bytes,
        window.base,
        this.size(),
        this.path,
      );
      if (token === this.disassemblyToken && listing !== null) {
        this.pluginListing.set(listing);
      }
      return;
    }
    // Whole-file decoders answer for the entire file at once, so the answer does not change as the
    // viewport moves — only when the bytes do.
    const version: number = this.editsVersion();
    if (this.wholeFileDecodeVersion === version) {
      return;
    }
    const size: number = this.size();
    if (size > MAX_WHOLE_FILE_DECODE) {
      return;
    }
    this.wholeFileDecodeVersion = version;
    const bytes: number[] = await this.readBytes(0, size);
    const listing: CodeListing | null = await this.disassembly.decodeListing(
      format,
      new Uint8Array(bytes),
      0,
      size,
      this.path,
      await this.readCompanions(),
    );
    if (listing !== null) {
      this.pluginListing.set(listing);
    } else {
      // Let a later attempt retry rather than caching a failure forever.
      this.wholeFileDecodeVersion = -1;
    }
  }

  /**
   * Reads the companion files a decoder may need for this document.
   *
   * A .NET assembly keeps its source mapping in a portable PDB beside it rather than inside itself, and
   * a decoder never touches disk — so the companion is read here, through the same gate as the
   * assembly, and handed over as bytes. A missing companion is ordinary: the decoder degrades to a
   * listing with no source lines.
   * @returns Returns the companions keyed by name, or undefined when none were found.
   */
  private async readCompanions(): Promise<Readonly<Record<string, Uint8Array>> | undefined> {
    const pdbPath: string = this.path.replace(/\.[^./\\]+$/, '.pdb');
    if (pdbPath === this.path) {
      return undefined;
    }
    const chunk: BinaryChunk | null = await this.workspace.readBytes(
      pdbPath,
      0,
      MAX_COMPANION_BYTES,
    );
    if (chunk === null || chunk.bytes.length === 0) {
      return undefined;
    }
    return { pdb: new Uint8Array(chunk.bytes) };
  }

  /**
   * Builds the byte buffer to disassemble for a range: the requested bytes padded on both sides (so an
   * instruction straddling either edge decodes) and read through {@link byteAt}, so pending edits are
   * reflected. Returns null when no bytes in the range are loaded yet.
   * @param offset The first byte of the range.
   * @param length The number of bytes in the range.
   * @returns Returns the padded buffer and its base offset, or null when nothing is loaded.
   */
  private disassemblyWindow(
    offset: number,
    length: number,
  ): { bytes: Uint8Array; base: number } | null {
    const start: number = Math.max(0, offset - DISASSEMBLY_PAD);
    const end: number = Math.min(this.size(), offset + length + DISASSEMBLY_PAD);
    let base: number = start;
    while (base < end && this.byteAt(base) === null) {
      base += 1;
    }
    const values: number[] = [];
    for (let position: number = base; position < end; position += 1) {
      const value: number | null = this.byteAt(position);
      if (value === null) {
        break;
      }
      values.push(value);
    }
    return values.length === 0 ? null : { bytes: Uint8Array.from(values), base };
  }

  /**
   * Cancels any pending disassembly request. Called when the document is released.
   */
  public dispose(): void {
    if (this.disassemblyTimer !== null) {
      clearTimeout(this.disassemblyTimer);
      this.disassemblyTimer = null;
    }
  }

  /**
   * Ensures every block spanning a byte range is cached or being fetched. Called by the view as its
   * viewport moves; missing blocks are read from the main process and fill the cache asynchronously.
   * @param offset The first byte of the range.
   * @param length The number of bytes in the range.
   */
  public ensureRange(offset: number, length: number): void {
    if (length <= 0) {
      return;
    }
    this.lastRange = { offset, length };
    // Before the first read the table is empty, so fetch the requested blocks directly; the logical
    // and file offsets are identical until the first edit anyway.
    if (!this.initialized) {
      this.ensureBlocks(offset, length);
      return;
    }
    // Map the logical range to the original-file ranges it overlaps (added spans need no read) and
    // fetch the blocks spanning each.
    this.table.forEachOriginalRange(offset, length, (fileStart: number, fileLength: number): void =>
      this.ensureBlocks(fileStart, fileLength),
    );
  }

  /**
   * Ensures every block spanning an original-file range is cached or being fetched.
   * @param fileOffset The first file offset.
   * @param length The number of file bytes.
   */
  private ensureBlocks(fileOffset: number, length: number): void {
    const first: number = Math.floor(fileOffset / BLOCK_SIZE);
    const last: number = Math.floor((fileOffset + length - 1) / BLOCK_SIZE);
    for (let block: number = first; block <= last; block += 1) {
      void this.ensureBlock(block);
    }
  }

  /**
   * Reads the bytes of the current selection that are already loaded. Bytes whose block has not loaded
   * are skipped, so a copy reflects the loaded portion of the selection.
   * @returns Returns the selected, loaded bytes in order.
   */
  public selectedBytes(): number[] {
    const selection: BinarySelection | null = this.selection();
    if (selection === null) {
      return [];
    }
    const bytes: number[] = [];
    for (let offset: number = selection.start; offset < selection.end; offset += 1) {
      const value: number | null = this.byteAt(offset);
      if (value !== null) {
        bytes.push(value);
      }
    }
    return bytes;
  }

  /**
   * Ensures the first block has loaded, so the file size and sniffed format are known. Awaited by the
   * agent read capabilities before they report an overview or disassemble a range.
   * @returns Returns a promise that settles once the first block is resident.
   */
  public async whenReady(): Promise<void> {
    await this.ensureBlock(0);
  }

  /**
   * Reads a contiguous byte range, fetching any blocks it spans and awaiting their arrival, then
   * reading the bytes through {@link byteAt} so pending edits are reflected. Used by the agent's read
   * capabilities; unlike the render path it waits for the bytes rather than returning holes. The range
   * is clamped to the document, and reading stops at the first byte that fails to load.
   * @param offset The first byte offset to read.
   * @param length The number of bytes to read.
   * @returns Returns the loaded bytes in order (shorter than requested at end-of-file or on a read
   * failure).
   */
  public async readBytes(offset: number, length: number): Promise<number[]> {
    await this.ensureBlock(0);
    const size: number = this.size();
    const start: number = Math.max(0, Math.min(offset, size));
    const end: number = Math.max(start, Math.min(offset + Math.max(0, length), size));
    if (end <= start) {
      return [];
    }
    await this.loadRange(start, end - start);
    const bytes: number[] = [];
    for (let position: number = start; position < end; position += 1) {
      const value: number | null = this.byteAt(position);
      if (value === null) {
        break;
      }
      bytes.push(value);
    }
    return bytes;
  }

  /**
   * Disassembles a byte range on demand for the agent, fetching and awaiting the bytes it spans (padded
   * so an instruction straddling either edge decodes). Returns null when the format is not natively
   * disassemblable, so the caller can report that clearly, and an empty list when the range holds no
   * loadable bytes.
   * @param offset The first byte of the range.
   * @param length The number of bytes in the range.
   * @returns Returns the decoded instructions, or null when disassembly does not apply.
   */
  public async disassembleRange(
    offset: number,
    length: number,
  ): Promise<readonly DecodedInstruction[] | null> {
    await this.ensureBlock(0);
    const architecture: string | null = disassemblyArchitecture(this.format());
    if (architecture === null) {
      return null;
    }
    const size: number = this.size();
    const start: number = Math.max(0, Math.min(offset, size));
    const end: number = Math.max(start, Math.min(offset + Math.max(0, length), size));
    if (end <= start) {
      return [];
    }
    const padStart: number = Math.max(0, start - DISASSEMBLY_PAD);
    await this.loadRange(padStart, end - padStart + DISASSEMBLY_PAD);
    const window: { bytes: Uint8Array; base: number } | null = this.disassemblyWindow(
      start,
      end - start,
    );
    if (window === null) {
      return [];
    }
    return this.disassembly.disassemble(window.bytes, window.base, start, end, architecture);
  }

  /**
   * Assembles a snippet of assembly into machine bytes for this document's architecture, so the agent
   * can write at the instruction level. The caller resolves the architecture (from the sniffed format)
   * and supplies the address the code lands at, so PC-relative operands resolve; the assembled bytes
   * are written back through {@link patch}, which keeps the file length unchanged.
   * @param assembly The assembly text (one or more instructions).
   * @param architecture The architecture label the code is assembled for.
   * @param address The absolute file offset the first instruction is assembled at.
   * @returns Returns the assembled bytes, or the reason assembly failed.
   */
  public assemble(
    assembly: string,
    architecture: string,
    address: number,
  ): Promise<AssembleResult> {
    return this.assembly.assemble(assembly, architecture, address);
  }

  /**
   * Overwrites a run of bytes at an offset with new values in a single undo transaction (leaving the
   * document's length unchanged). Used by the agent's patch capability; it makes an unsaved, undoable
   * edit that the user saves through the ribbon. The first block is loaded first so the document size
   * is known and the range can be validated.
   * @param offset The logical byte offset to overwrite from.
   * @param values The new byte values (0–255).
   * @returns Returns true when the bytes were overwritten, false when the range is out of bounds.
   */
  public async patch(offset: number, values: readonly number[]): Promise<boolean> {
    await this.ensureBlock(0);
    if (
      !this.initialized ||
      values.length === 0 ||
      offset < 0 ||
      offset + values.length > this.size()
    ) {
      return false;
    }
    const bytes: number[] = values.map((value: number): number => value & 0xff);
    this.applyEdit((): void => this.table.replace(offset, bytes.length, bytes));
    return true;
  }

  /**
   * Inserts a run of bytes before an offset in a single undo transaction, growing the document. Used
   * by the agent's insert capability; it makes an unsaved, undoable edit that the user saves through
   * the ribbon. The first block is loaded first so the document size is known and the offset can be
   * validated.
   * @param offset The logical offset to insert before (0 to the end of the document).
   * @param values The byte values (0–255) to insert.
   * @returns Returns true when the bytes were inserted, false when the offset is out of bounds.
   */
  public async insertBytes(offset: number, values: readonly number[]): Promise<boolean> {
    await this.ensureBlock(0);
    if (!this.initialized || values.length === 0 || offset < 0 || offset > this.size()) {
      return false;
    }
    const bytes: number[] = values.map((value: number): number => value & 0xff);
    this.applyEdit((): void => this.table.replace(offset, 0, bytes));
    return true;
  }

  /**
   * Deletes a run of bytes in a single undo transaction, shrinking the document. Used by the agent's
   * delete capability; it makes an unsaved, undoable edit that the user saves through the ribbon. The
   * first block is loaded first so the document size is known and the range can be validated.
   * @param offset The first logical offset to delete.
   * @param count The number of bytes to delete.
   * @returns Returns true when the bytes were deleted, false when the range is out of bounds.
   */
  public async removeBytes(offset: number, count: number): Promise<boolean> {
    await this.ensureBlock(0);
    if (!this.initialized || count <= 0 || offset < 0 || offset + count > this.size()) {
      return false;
    }
    this.applyEdit((): void => this.table.replace(offset, count, []));
    return true;
  }

  /**
   * Ensures every block spanning a byte range is cached, awaiting the in-flight fetches so the bytes
   * are readable when the promise settles. The awaitable counterpart to {@link ensureRange}.
   * @param offset The first byte of the range.
   * @param length The number of bytes in the range.
   * @returns Returns a promise that settles once the range's blocks are resident.
   */
  private async loadRange(offset: number, length: number): Promise<void> {
    if (length <= 0) {
      return;
    }
    const fetches: Promise<void>[] = [];
    const ensureFileBlocks: (fileOffset: number, fileLength: number) => void = (
      fileOffset: number,
      fileLength: number,
    ): void => {
      const first: number = Math.floor(fileOffset / BLOCK_SIZE);
      const last: number = Math.floor((fileOffset + fileLength - 1) / BLOCK_SIZE);
      for (let block: number = first; block <= last; block += 1) {
        fetches.push(this.ensureBlock(block));
      }
    };
    // Before the first edit the logical and file offsets are identical; afterwards, map the logical
    // range to the original-file ranges it overlaps (added spans need no read) and fetch each.
    if (!this.initialized) {
      ensureFileBlocks(offset, length);
    } else {
      this.table.forEachOriginalRange(offset, length, ensureFileBlocks);
    }
    await Promise.all(fetches);
  }

  /**
   * Gets the byte at an offset from the block cache alone (ignoring pending edits), or null when its
   * block has not loaded or the offset is past the end of the file.
   * @param offset The absolute byte offset.
   * @returns Returns the on-disk byte value, or null when unavailable.
   */
  private cachedByteAt(offset: number): number | null {
    const block: number = Math.floor(offset / BLOCK_SIZE);
    const bytes: Uint8Array | undefined = this.blocks.get(block);
    if (bytes === undefined) {
      return null;
    }
    const local: number = offset - block * BLOCK_SIZE;
    return local < bytes.length ? bytes[local] : null;
  }

  /**
   * Writes an edited byte into the block cache, so a saved edit becomes the on-disk baseline the cache
   * reports.
   * @param offset The absolute byte offset.
   * @param value The byte value to store.
   */
  private applyToCache(offset: number, value: number): void {
    const block: number = Math.floor(offset / BLOCK_SIZE);
    const bytes: Uint8Array | undefined = this.blocks.get(block);
    if (bytes === undefined) {
      return;
    }
    const local: number = offset - block * BLOCK_SIZE;
    if (local < bytes.length) {
      bytes[local] = value & 0xff;
    }
  }

  /**
   * Fetches a single block if it is neither cached nor already in flight, filling the cache and
   * recording the file size on arrival. Returns a promise that resolves once the block is resident (or
   * immediately when it already is), so callers such as {@link readBytes} can await the bytes.
   * @param block The block index to fetch.
   * @returns Returns a promise that settles when the block is loaded.
   */
  private ensureBlock(block: number): Promise<void> {
    if (block < 0) {
      return Promise.resolve();
    }
    if (this.blocks.has(block)) {
      this.touchBlock(block);
      return Promise.resolve();
    }
    const existing: Promise<void> | undefined = this.blockFetches.get(block);
    if (existing !== undefined) {
      return existing;
    }
    const fetch: Promise<void> = this.workspace
      .readBytes(this.path, block * BLOCK_SIZE, BLOCK_SIZE)
      .then((chunk: BinaryChunk | null): void => {
        if (chunk === null) {
          return;
        }
        this.blocks.set(block, chunk.bytes);
        this.evictBlocks();
        // The first read learns the file size; initialise the piece table (and logical size) to the
        // whole file once, so later re-fetches after an edit or save do not reset the edit model.
        if (!this.initialized) {
          this.originalSize = chunk.size;
          this.table.init(chunk.size);
          this.size.set(this.table.length());
          this.initialized = true;
        }
        // The first block carries the file header; sniff the container format from it and locate the
        // code, then jump there so the view opens on real instructions rather than the headers.
        if (block === 0 && this.format().kind === 'unknown') {
          this.format.set(sniffFormat(chunk.bytes));
          const code: number | null = codeOffset(chunk.bytes);
          this.codeOffset.set(code);
          if (code !== null) {
            this.reveal(code);
          }
        }
        this.loadedVersion.update((version: number): number => version + 1);
      })
      .finally((): void => {
        this.blockFetches.delete(block);
      });
    this.blockFetches.set(block, fetch);
    return fetch;
  }

  /**
   * Marks a block as most recently used, so eviction favours blocks the viewport has moved away from.
   * @param block The block index that was just accessed.
   */
  private touchBlock(block: number): void {
    const bytes: Uint8Array | undefined = this.blocks.get(block);
    if (bytes !== undefined) {
      this.blocks.delete(block);
      this.blocks.set(block, bytes);
    }
  }

  /**
   * Evicts the least recently used blocks until the cache is within its resident cap, bounding memory
   * on very large files. The map's insertion order (kept current by {@link touchBlock}) is the LRU
   * order, so the oldest keys are dropped first.
   */
  private evictBlocks(): void {
    while (this.blocks.size > MAX_RESIDENT_BLOCKS) {
      const oldest: number | undefined = this.blocks.keys().next().value;
      if (oldest === undefined) {
        return;
      }
      this.blocks.delete(oldest);
    }
  }

  /**
   * Gets the number of file blocks currently held in the cache. Exposed for diagnostics and tests to
   * confirm the resident cap bounds memory.
   * @returns Returns the resident block count.
   */
  public residentBlockCount(): number {
    return this.blocks.size;
  }

  /**
   * Gets the byte range of the decoded instruction that covers an offset, for snapping a selection to
   * whole-instruction boundaries. Resolves only within the currently disassembled (visible) range.
   * @param offset The logical byte offset.
   * @returns Returns the instruction's range, or null when no instruction covers the offset.
   */
  public instructionRangeAt(offset: number): BinarySelection | null {
    for (const instruction of this.instructions()) {
      if (
        offset >= instruction.startOffset &&
        offset < instruction.startOffset + instruction.byteLength
      ) {
        return {
          start: instruction.startOffset,
          end: instruction.startOffset + instruction.byteLength,
        };
      }
    }
    return null;
  }
}

/**
 * Represents the registry of open binary documents, keyed by their owning tab. The file opener asks it
 * to open a file (creating a top-level binary tab and its document), and the binary view, ribbon, and
 * status resolve the active document from it — mirroring how {@link Documents} backs code tabs.
 */
@Service()
export class BinaryDocuments implements UnsavedWorkSource {
  /**
   * Holds the tab registry binary tabs are opened in.
   */
  private readonly tabs: Tabs = inject(Tabs);

  /**
   * Holds the workspace client each document reads its bytes through.
   */
  private readonly workspace: Workspace = inject(Workspace);

  /**
   * Holds the disassembly client each document decodes its instructions through.
   */
  private readonly disassembly: BinaryDisassembly = inject(BinaryDisassembly);

  /**
   * Holds the assembly client each document assembles the agent's instruction-level edits through.
   */
  private readonly assembly: BinaryAssembly = inject(BinaryAssembly);

  /**
   * Holds the file-watch service each document's file is subscribed to, so external on-disk changes
   * re-render the document.
   */
  private readonly fileWatch: FileWatch = inject(FileWatch);

  /**
   * Holds the file-conflict registry a dirty document's external change is raised on, deferring the
   * keep-or-reload decision to the user.
   */
  private readonly fileConflicts: FileConflicts = inject(FileConflicts);

  /**
   * Holds the injector used to create each document's tab-dirty synchronisation effect (documents
   * are opened outside a reactive context).
   */
  private readonly injector: Injector = inject(Injector);

  /**
   * Holds the structured logger for binary-document lifecycle and outcomes.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the open documents, keyed by owning tab identifier.
   */
  private readonly entries: Map<string, BinaryDocumentEntry> = new Map<
    string,
    BinaryDocumentEntry
  >();

  /**
   * Holds each open document's tab-dirty synchronisation effect, disposed when the tab closes.
   */
  private readonly dirtyEffects: Map<string, EffectRef> = new Map<string, EffectRef>();

  /**
   * Holds each open document's file-watch disposer, disposed when the tab closes.
   */
  private readonly watchDisposers: Map<string, () => void> = new Map<string, () => void>();

  /**
   * Opens a file in a binary tab, reusing an existing tab for the same path, and returns the tab. The
   * document reads its bytes lazily, so opening is cheap however large the file.
   * @param path The absolute path of the file to open.
   * @returns Returns the opened, or re-activated, tab.
   */
  public open(path: string): Tab {
    const tab: Tab = this.tabs.open('binary', path);
    if (!this.entries.has(tab.id)) {
      this.log.info('binary.document', 'Opening binary file', path);
      const fileName: string = this.basename(path);
      const entry: BinaryDocumentEntry = new BinaryDocumentEntry(
        tab.id,
        path,
        fileName,
        this.workspace,
        this.disassembly,
        this.assembly,
      );
      this.entries.set(tab.id, entry);
      this.tabs.rename(tab.id, fileName);
      // Mirror the document's dirty flag onto its tab, so edited binary files show the same dirty
      // indicator as edited code and markdown tabs.
      this.dirtyEffects.set(
        tab.id,
        effect((): void => this.tabs.setDirty(tab.id, entry.dirty()), { injector: this.injector }),
      );
      this.watchDisposers.set(
        tab.id,
        this.fileWatch.watchPath(path, (): void => this.onDiskChange(tab.id)),
      );
      entry.prime();
    }
    this.tabs.activate(tab.id);
    // Return the tab as it stands in the registry, so callers see the file-name title set above rather
    // than the default label the tab was created with (Tabs renames via an immutable replacement).
    return this.tabs.get(tab.id) ?? tab;
  }

  /**
   * Gets the open binary document for a tab, or undefined when the tab has none.
   * @param tabId The owning tab identifier.
   * @returns Returns the document, or undefined.
   */
  public get(tabId: string): BinaryDocumentEntry | undefined {
    return this.entries.get(tabId);
  }

  /**
   * Releases the document backing a tab when its view is destroyed (the tab closed).
   * @param tabId The owning tab identifier.
   */
  public release(tabId: string): void {
    this.log.debug('binary.document', 'Releasing binary document', tabId);
    this.dirtyEffects.get(tabId)?.destroy();
    this.dirtyEffects.delete(tabId);
    this.watchDisposers.get(tabId)?.();
    this.watchDisposers.delete(tabId);
    this.fileConflicts.clear(tabId);
    this.entries.get(tabId)?.dispose();
    this.entries.delete(tabId);
  }

  /**
   * Handles a document's file changing on disk. The echo of the application's own save is ignored; an
   * external change reloads a clean document in place, and raises a keep-or-reload conflict for a
   * dirty one so the user's unsaved edits are never silently discarded.
   * @param tabId The owning tab identifier.
   */
  private onDiskChange(tabId: string): void {
    const entry: BinaryDocumentEntry | undefined = this.entries.get(tabId);
    if (entry === undefined || entry.recentlySaved(SAVE_ECHO_WINDOW_MS)) {
      return;
    }
    if (!entry.dirty()) {
      this.log.info('binary.document', 'External change; reloading clean document', entry.path);
      void entry.reloadFromDisk();
      return;
    }
    this.log.warn(
      'binary.document',
      'External change on dirty document; raising keep-or-reload conflict',
      entry.path,
    );
    this.fileConflicts.raise(
      { documentId: tabId, tabId, name: entry.fileName },
      {
        keep: (): void => undefined,
        reload: (): void => void entry.reloadFromDisk(),
      },
    );
  }

  /**
   * Lists the binary documents with unsaved edits, in insertion order. Part of the unsaved-work
   * contract the lifecycle walks before the window closes.
   * @returns Returns each dirty document's owning tab id and display file name.
   */
  public dirtyDocuments(): readonly UnsavedDocument[] {
    const dirty: UnsavedDocument[] = [];
    for (const entry of this.entries.values()) {
      if (entry.dirty()) {
        dirty.push({ id: entry.tabId, name: entry.fileName });
      }
    }
    return dirty;
  }

  /**
   * Lists the dirty documents hosted by the given tab. Each binary file is its own top-level tab, so
   * this is the document with that id when it is dirty.
   * @param tabId The closing tab's identifier.
   * @returns Returns the dirty documents the tab hosts.
   */
  public dirtyDocumentsFor(tabId: string): readonly UnsavedDocument[] {
    return this.dirtyDocuments().filter(
      (document: UnsavedDocument): boolean => document.id === tabId,
    );
  }

  /**
   * Saves a binary document's pending edits. Part of the unsaved-work contract the lifecycle walks
   * before the window closes.
   * @param id The owning tab identifier.
   * @returns Returns true when the document was saved (or had nothing to save); false when the
   * write failed, so the close is aborted rather than discarding the edits.
   */
  public async save(id: string): Promise<boolean> {
    const entry: BinaryDocumentEntry | undefined = this.entries.get(id);
    if (entry === undefined) {
      return true;
    }
    const saved: boolean = await entry.save();
    if (saved) {
      this.log.info('binary.document', 'Saved binary document', entry.path);
    } else {
      this.log.error('binary.document', 'Failed to save binary document', entry.path);
    }
    return saved;
  }

  /**
   * Extracts the base name from an absolute path, handling both separators.
   * @param path The absolute path.
   * @returns Returns the file's base name.
   */
  private basename(path: string): string {
    const parts: string[] = path.split(/[\\/]/);
    return parts[parts.length - 1] || path;
  }
}
