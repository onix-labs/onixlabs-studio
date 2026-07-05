import { inject, Service, signal, WritableSignal } from '@angular/core';
import { BinaryChunk } from '@shared/api/workspace-channels';
import { Tab } from '@shared/angular/services/tabs/tab';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import { Workspace } from '@shared/angular/services/workspace/workspace';

/**
 * Specifies the size, in bytes, of each block fetched and cached from a file. A multiple of the row
 * width so a block boundary never splits a rendered row. Larger than a typical viewport so scrolling
 * within a block needs no further reads.
 */
const BLOCK_SIZE: number = 64 * 1024;

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
   * Holds the set of block indices whose fetch is in flight, so a block is never fetched twice.
   */
  private readonly pending: Set<number> = new Set<number>();

  /**
   * Holds the total file size in bytes, learned from the first read.
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
   */
  public constructor(
    public readonly tabId: string,
    public readonly path: string,
    public readonly fileName: string,
    private readonly workspace: Workspace,
  ) {}

  /**
   * Fetches the first block so the file size becomes known and the first screen has data.
   */
  public prime(): void {
    this.ensureBlock(0);
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
    const block: number = Math.floor(offset / BLOCK_SIZE);
    const bytes: Uint8Array | undefined = this.blocks.get(block);
    if (bytes === undefined) {
      return null;
    }
    const local: number = offset - block * BLOCK_SIZE;
    return local < bytes.length ? bytes[local] : null;
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
    const first: number = Math.floor(offset / BLOCK_SIZE);
    const last: number = Math.floor((offset + length - 1) / BLOCK_SIZE);
    for (let block: number = first; block <= last; block += 1) {
      this.ensureBlock(block);
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
   * Fetches a single block if it is neither cached nor already in flight, filling the cache and
   * recording the file size on arrival.
   * @param block The block index to fetch.
   */
  private ensureBlock(block: number): void {
    if (block < 0 || this.blocks.has(block) || this.pending.has(block)) {
      return;
    }
    this.pending.add(block);
    void this.workspace
      .readBytes(this.path, block * BLOCK_SIZE, BLOCK_SIZE)
      .then((chunk: BinaryChunk | null): void => {
        this.pending.delete(block);
        if (chunk === null) {
          return;
        }
        this.size.set(chunk.size);
        this.blocks.set(block, chunk.bytes);
        this.loadedVersion.update((version: number): number => version + 1);
      });
  }
}

/**
 * Represents the registry of open binary documents, keyed by their owning tab. The file opener asks it
 * to open a file (creating a top-level binary tab and its document), and the binary view, ribbon, and
 * status resolve the active document from it — mirroring how {@link Documents} backs code tabs.
 */
@Service()
export class BinaryDocuments {
  /**
   * Holds the tab registry binary tabs are opened in.
   */
  private readonly tabs: Tabs = inject(Tabs);

  /**
   * Holds the workspace client each document reads its bytes through.
   */
  private readonly workspace: Workspace = inject(Workspace);

  /**
   * Holds the open documents, keyed by owning tab identifier.
   */
  private readonly entries: Map<string, BinaryDocumentEntry> = new Map<
    string,
    BinaryDocumentEntry
  >();

  /**
   * Opens a file in a binary tab, reusing an existing tab for the same path, and returns the tab. The
   * document reads its bytes lazily, so opening is cheap however large the file.
   * @param path The absolute path of the file to open.
   * @returns Returns the opened, or re-activated, tab.
   */
  public open(path: string): Tab {
    const tab: Tab = this.tabs.open('binary', path);
    if (!this.entries.has(tab.id)) {
      const fileName: string = this.basename(path);
      const entry: BinaryDocumentEntry = new BinaryDocumentEntry(
        tab.id,
        path,
        fileName,
        this.workspace,
      );
      this.entries.set(tab.id, entry);
      this.tabs.rename(tab.id, fileName);
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
    this.entries.delete(tabId);
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
