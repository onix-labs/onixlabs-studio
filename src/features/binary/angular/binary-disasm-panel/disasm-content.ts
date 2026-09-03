import { CodeListing, ListingRow, ListingSection } from '@shared/api/code-listing';

// Turns a code listing into the text the assembly panel shows, and the map from rendered line back to
// the row it shows. Pure and separated from the component so the mapping — the part with all the ways
// to be subtly wrong — is testable without Monaco.

/**
 * Maps a rendered line back to the row it shows.
 */
export interface LineRow {
  /**
   * Gets the row's absolute file offset, or null when the row has no bytes in the file (a JIT
   * instruction, whose code exists only in a running process).
   */
  readonly fileOffset: number | null;

  /**
   * Gets the row's length in bytes, or zero when it has none.
   */
  readonly byteLength: number;
}

/**
 * Holds the rendered listing text and its per-line row map.
 */
export interface DisasmContent {
  /**
   * Gets the listing text, one row per line.
   */
  readonly text: string;

  /**
   * Gets the per-line row map, where index `i` is line `i + 1`.
   *
   * **Sparse**: a section heading or a note occupies a line but shows no row, so those entries are
   * null. Reading this as a dense array of instructions is the mistake it exists to prevent.
   */
  readonly lines: readonly (LineRow | null)[];
}

/**
 * Holds an empty listing's content, so a caller with nothing to show has something to bind.
 */
export const EMPTY_CONTENT: DisasmContent = { text: '', lines: [] };

/**
 * Renders an address in the base the listing's own toolchain uses.
 *
 * JVM bytecode is conventionally read in decimal, because that is what `javap` prints and what a
 * `LineNumberTable` and branch targets are expressed in. Everything else — native code, IL — is read in
 * hex. Mixing the two within one listing makes branch targets look like they point at nothing.
 * @param address The address to render.
 * @param listing The listing being rendered, which decides the base.
 * @returns Returns the rendered address.
 */
export function renderAddress(address: number, listing: CodeListing): string {
  return isDecimalAddressed(listing)
    ? String(address).padStart(6, ' ')
    : address.toString(16).toUpperCase().padStart(8, '0');
}

/**
 * Determines whether a listing's addresses are conventionally read in decimal.
 * @param listing The listing.
 * @returns Returns true when addresses should be rendered in decimal.
 */
function isDecimalAddressed(listing: CodeListing): boolean {
  return listing.addressing === 'method-relative' && listing.language.startsWith('JVM');
}

/**
 * Builds the panel's text and line map from a listing.
 *
 * A single-section listing — which is what native disassembly produces — renders exactly as it always
 * did, with no heading, so migrating the native path to this contract changes nothing on screen. A
 * multi-section listing gains a blank line and a heading before each section, and its notes beneath.
 * @param listing The listing to render, or null when there is nothing to show.
 * @returns Returns the text and the per-line row map.
 */
export function buildContent(listing: CodeListing | null): DisasmContent {
  if (listing === null || listing.sections.length === 0) {
    return EMPTY_CONTENT;
  }
  const rows: string[] = [];
  const lines: (LineRow | null)[] = [];
  // A source-line gutter only appears when the listing actually carries lines, so a decoder without a
  // source mapping does not pay for an empty column on every row.
  const showSourceLines: boolean = listing.sections.some((section: ListingSection): boolean =>
    section.rows.some((row: ListingRow): boolean => row.sourceLine !== undefined),
  );
  // A single-section listing shows no heading: that is what native disassembly produces, the panel
  // header already says "Assembly", and the status strip already names the format — so a lone heading
  // would be a third statement of the same thing, and would change what users see today for nothing.
  const showHeadings: boolean = listing.sections.length > 1;

  listing.sections.forEach((section: ListingSection, index: number): void => {
    if (showHeadings) {
      if (index > 0) {
        rows.push('');
        lines.push(null);
      }
      const indent: string = showSourceLines ? '      ' : '';
      rows.push(`${indent}${section.title}`);
      lines.push(null);
      for (const note of section.notes ?? []) {
        rows.push(`${indent}  ; ${note}`);
        lines.push(null);
      }
    }
    for (const row of section.rows) {
      rows.push(renderRow(row, listing, showSourceLines));
      lines.push({
        fileOffset: row.fileOffset ?? null,
        byteLength: row.bytes?.length ?? 0,
      });
    }
  });

  return { text: rows.join('\n'), lines };
}

/**
 * Renders one row.
 * @param row The row to render.
 * @param listing The listing being rendered, which decides the address base.
 * @returns Returns the rendered line.
 */
function renderRow(row: ListingRow, listing: CodeListing, showSourceLines: boolean): string {
  const gutter: string = showSourceLines ? renderSourceLine(row.sourceLine) : '';
  if (row.kind === 'label') {
    const at: string =
      row.address === undefined ? '' : `  ; ${renderAddress(row.address, listing).trim()}`;
    return `${gutter}${row.mnemonic}:${at}`;
  }
  if (row.kind === 'comment') {
    return `${gutter}  ; ${row.mnemonic}`;
  }
  // A row with no address is not a defect: the .NET JIT reports an offset per instruction group and
  // none per instruction, so its rows are aligned under the group label rather than given a made-up
  // address.
  const address: string =
    row.address === undefined ? ' '.repeat(8) : renderAddress(row.address, listing);
  const operands: string = row.operands.length > 0 ? ` ${row.operands}` : '';
  const comment: string = row.comment === undefined ? '' : `   // ${row.comment}`;
  return `${gutter}${address}  ${row.mnemonic}${operands}${comment}`;
}

/**
 * Renders the source-line gutter for a row.
 *
 * A row with no line keeps the column's width rather than collapsing it, so the addresses beside it
 * stay in one column — a ragged left edge reads as corruption in a listing.
 * @param sourceLine The row's source line, when it has one.
 * @returns Returns the gutter text.
 */
function renderSourceLine(sourceLine: number | undefined): string {
  return sourceLine === undefined ? '      ' : `${String(sourceLine).padStart(5)} `;
}

/**
 * Finds the one-based line showing the row that covers a byte offset.
 *
 * Keyed on file offset rather than on the row's address, because under method-relative addressing every
 * method's addresses restart at zero — resolving on address would land in the first section every time.
 * @param content The built content.
 * @param fileOffset The absolute file offset to locate.
 * @returns Returns the one-based line number, or null when no line shows that offset.
 */
export function lineForFileOffset(content: DisasmContent, fileOffset: number): number | null {
  const index: number = content.lines.findIndex(
    (line: LineRow | null): boolean =>
      line?.fileOffset != null &&
      line.fileOffset <= fileOffset &&
      fileOffset < line.fileOffset + Math.max(line.byteLength, 1),
  );
  return index === -1 ? null : index + 1;
}

/**
 * Finds every one-based line whose row's bytes overlap a byte range.
 * @param content The built content.
 * @param start The first byte offset of the range.
 * @param end The offset one past the last byte of the range.
 * @returns Returns the overlapping line numbers, ascending.
 */
export function linesForRange(
  content: DisasmContent,
  start: number,
  end: number,
): readonly number[] {
  const result: number[] = [];
  content.lines.forEach((line: LineRow | null, index: number): void => {
    if (line?.fileOffset === null || line?.fileOffset === undefined) {
      return;
    }
    if (line.fileOffset < end && line.fileOffset + Math.max(line.byteLength, 1) > start) {
      result.push(index + 1);
    }
  });
  return result;
}
