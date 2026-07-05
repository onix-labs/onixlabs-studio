/**
 * Describes one span of a binary document's logical byte sequence. A piece points either at a range of
 * the original on-disk file (`original`) or at a range of the in-memory added buffer (`added`), so
 * inserts and deletes are represented by rearranging spans rather than moving bytes.
 */
export interface Piece {
  /**
   * Gets which buffer the span's bytes come from.
   */
  readonly source: 'original' | 'added';

  /**
   * Gets the span's start offset within its source buffer (a file offset for `original`, an index into
   * the added buffer for `added`).
   */
  readonly start: number;

  /**
   * Gets the span's length in bytes.
   */
  readonly length: number;
}

/**
 * Describes where a logical offset resolves: to an original-file offset (whose byte the caller reads
 * from its block cache) or to an already-known added byte value.
 */
export type PieceLocation = { readonly original: number } | { readonly value: number };

/**
 * Describes a contiguous run of overwritten bytes at a fixed offset, used to save overwrite-only edits
 * in place.
 */
export interface PieceRun {
  /**
   * Gets the run's start offset.
   */
  readonly offset: number;

  /**
   * Gets the run's byte values.
   */
  readonly bytes: number[];
}

/**
 * Captures a piece table's mutable state, so an edit can be undone by restoring the state that preceded
 * it. The added buffer is append-only and therefore not snapshotted — restored pieces still reference
 * valid ranges within it.
 */
export interface PieceTableSnapshot {
  /**
   * Gets the pieces at the time of the snapshot.
   */
  readonly pieces: readonly Piece[];

  /**
   * Gets the logical length at the time of the snapshot.
   */
  readonly total: number;

  /**
   * Gets whether a length-changing edit had occurred at the time of the snapshot.
   */
  readonly structural: boolean;
}

/**
 * Represents a binary document's edit model as a piece table over an unchanging original file plus an
 * append-only added buffer. All three edits — overwrite, insert, delete — are expressed through
 * {@link replace}; the table never mutates the original file, so reads stay lazy and windowed and edits
 * are cheap to snapshot for undo.
 */
export class PieceTable {
  /**
   * Holds the ordered spans that make up the logical byte sequence.
   */
  private pieces: Piece[] = [];

  /**
   * Holds the append-only buffer inserted and overwritten bytes are stored in.
   */
  private readonly added: number[] = [];

  /**
   * Holds the logical length in bytes (the sum of the pieces' lengths).
   */
  private total: number = 0;

  /**
   * Holds the original file's size in bytes.
   */
  private originalSize: number = 0;

  /**
   * Holds whether a length-changing edit (an insert or delete) has occurred, so a save can choose an
   * in-place patch (overwrite-only) or a full rewrite (structural).
   */
  private structural: boolean = false;

  /**
   * Initialises the table to represent the whole original file with no edits.
   * @param originalSize The original file's size in bytes.
   */
  public init(originalSize: number): void {
    this.originalSize = originalSize;
    this.reset();
  }

  /**
   * Gets the logical length in bytes.
   * @returns Returns the number of bytes in the logical sequence.
   */
  public length(): number {
    return this.total;
  }

  /**
   * Gets whether a length-changing edit has occurred since the last reset.
   * @returns Returns true when the logical byte sequence has been inserted into or deleted from.
   */
  public isStructural(): boolean {
    return this.structural;
  }

  /**
   * Resolves a logical offset to its source: an original-file offset or an added byte value.
   * @param offset The logical offset.
   * @returns Returns the location, or null when the offset is out of range.
   */
  public locate(offset: number): PieceLocation | null {
    if (offset < 0 || offset >= this.total) {
      return null;
    }
    let logical: number = 0;
    for (const piece of this.pieces) {
      if (offset < logical + piece.length) {
        const sourcePos: number = piece.start + (offset - logical);
        return piece.source === 'added' ? { value: this.added[sourcePos] } : { original: sourcePos };
      }
      logical += piece.length;
    }
    return null;
  }

  /**
   * Invokes a callback for each original-file range that a logical range overlaps, so the caller can
   * fetch exactly the file blocks a viewport needs. Added spans contribute nothing to fetch.
   * @param offset The first logical offset.
   * @param length The number of logical bytes.
   * @param callback Receives each original-file start offset and length.
   */
  public forEachOriginalRange(
    offset: number,
    length: number,
    callback: (fileStart: number, fileLength: number) => void,
  ): void {
    const end: number = offset + length;
    let logical: number = 0;
    for (const piece of this.pieces) {
      const pieceEnd: number = logical + piece.length;
      if (piece.source === 'original' && pieceEnd > offset && logical < end) {
        const from: number = Math.max(offset, logical);
        const to: number = Math.min(end, pieceEnd);
        callback(piece.start + (from - logical), to - from);
      }
      logical = pieceEnd;
    }
  }

  /**
   * Replaces a logical range with new bytes: the single primitive behind overwrite (`deleteCount` equals
   * the insert length), insert (`deleteCount` is zero), and delete (the insert is empty). The original
   * file is never touched; new bytes are appended to the added buffer and referenced by a new span.
   * @param offset The first logical offset to replace.
   * @param deleteCount The number of logical bytes to remove.
   * @param insert The bytes to insert in their place.
   */
  public replace(offset: number, deleteCount: number, insert: readonly number[]): void {
    const start: number = Math.max(0, Math.min(offset, this.total));
    const removed: number = Math.max(0, Math.min(deleteCount, this.total - start));
    const addedStart: number = this.added.length;
    for (const byte of insert) {
      this.added.push(byte & 0xff);
    }
    const cutEnd: number = start + removed;
    const result: Piece[] = [];
    let logical: number = 0;
    for (const piece of this.pieces) {
      const pieceEnd: number = logical + piece.length;
      if (pieceEnd <= start || logical >= cutEnd) {
        result.push(piece);
      } else {
        if (logical < start) {
          result.push({ source: piece.source, start: piece.start, length: start - logical });
        }
        if (pieceEnd > cutEnd) {
          const skip: number = cutEnd - logical;
          result.push({
            source: piece.source,
            start: piece.start + skip,
            length: pieceEnd - cutEnd,
          });
        }
      }
      logical = pieceEnd;
    }
    if (insert.length > 0) {
      result.splice(insertionIndex(result, start), 0, {
        source: 'added',
        start: addedStart,
        length: insert.length,
      });
    }
    this.pieces = result;
    this.total = this.total - removed + insert.length;
    if (removed !== insert.length) {
      this.structural = true;
    }
  }

  /**
   * Captures the current state so a later {@link restore} can undo an edit.
   * @returns Returns the snapshot.
   */
  public snapshot(): PieceTableSnapshot {
    return { pieces: this.pieces.slice(), total: this.total, structural: this.structural };
  }

  /**
   * Restores a captured state, undoing (or redoing) the edits after it.
   * @param snapshot The snapshot to restore.
   */
  public restore(snapshot: PieceTableSnapshot): void {
    this.pieces = snapshot.pieces.slice();
    this.total = snapshot.total;
    this.structural = snapshot.structural;
  }

  /**
   * Gets whether the table currently represents the unedited original file.
   * @returns Returns true when there are no effective edits.
   */
  public isPristine(): boolean {
    if (this.originalSize === 0) {
      return this.pieces.length === 0;
    }
    return (
      this.pieces.length === 1 &&
      this.pieces[0].source === 'original' &&
      this.pieces[0].start === 0 &&
      this.pieces[0].length === this.originalSize
    );
  }

  /**
   * Builds the in-place patches that save overwrite-only edits. Valid only when no structural edit has
   * occurred, so every logical offset still equals its file offset. Consecutive added spans coalesce
   * into one run.
   * @returns Returns the runs to write, in ascending offset order.
   */
  public overwritePatches(): PieceRun[] {
    const runs: PieceRun[] = [];
    let logical: number = 0;
    for (const piece of this.pieces) {
      if (piece.source === 'added') {
        const bytes: number[] = this.added.slice(piece.start, piece.start + piece.length);
        const last: PieceRun | undefined = runs[runs.length - 1];
        if (last !== undefined && last.offset + last.bytes.length === logical) {
          last.bytes.push(...bytes);
        } else {
          runs.push({ offset: logical, bytes });
        }
      }
      logical += piece.length;
    }
    return runs;
  }

  /**
   * Gets the pieces, for streaming a structural save.
   * @returns Returns the current spans.
   */
  public spans(): readonly Piece[] {
    return this.pieces;
  }

  /**
   * Gets the added buffer's bytes, for streaming a structural save.
   * @returns Returns the appended bytes.
   */
  public addedBytes(): Uint8Array {
    return Uint8Array.from(this.added);
  }

  /**
   * Resets the table to represent the whole (possibly newly sized) original file with no edits, after a
   * save has made the on-disk file match the logical content.
   * @param originalSize The new original file size, or omitted to keep the current size.
   */
  public reset(originalSize?: number): void {
    if (originalSize !== undefined) {
      this.originalSize = originalSize;
    }
    this.added.length = 0;
    this.pieces =
      this.originalSize === 0
        ? []
        : [{ source: 'original', start: 0, length: this.originalSize }];
    this.total = this.originalSize;
    this.structural = false;
  }
}

/**
 * Finds the index in a piece list at which a logical offset falls on a boundary, for splicing in an
 * inserted span. A delete has already split the pieces so a boundary exists exactly at the offset.
 * @param pieces The pieces to walk.
 * @param offset The logical offset to place the insertion at.
 * @returns Returns the splice index.
 */
function insertionIndex(pieces: readonly Piece[], offset: number): number {
  let logical: number = 0;
  for (let index: number = 0; index < pieces.length; index += 1) {
    if (logical === offset) {
      return index;
    }
    logical += pieces[index].length;
  }
  return pieces.length;
}
