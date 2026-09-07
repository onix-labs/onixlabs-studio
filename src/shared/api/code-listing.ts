import { DecodedInstruction } from './binary-channels';

// The code-listing contract shared between the Electron main process, the renderer, and every decoder
// plugin. Keep this module platform-neutral (no Node or DOM dependencies) so all three can import it.
//
// This WRAPS `DecodedInstruction` rather than replacing it. That contract is offset-keyed and flat,
// which is correct for linear native disassembly and wrong for everything else: IL and JVM bytecode are
// method-keyed and structural, and JIT assembly is produced by a running process and exists in no file
// at all. A native listing is simply a listing with one section.
//
// Two fields are optional for reasons established by measurement rather than convenience, and both are
// load-bearing. See `ListingRow.address` and `ListingRow.fileOffset`.

/**
 * Says what a row's {@link ListingRow.address} actually means. This is the crux of the contract:
 * "offset" means three different things across the decoders, and conflating them is how a single flat
 * offset-keyed shape would have had to lie.
 */
export type ListingAddressing =
  /**
   * The address is the absolute file offset. Native machine code, and WebAssembly — whose function
   * bodies are addressed by file offset rather than relative to the function.
   */
  | 'file-offset'
  /**
   * The address is a byte offset within the enclosing method's body. JVM bytecode and .NET IL.
   *
   * Note that under this addressing an address is **not unique across sections** — every method starts
   * at zero — so anything resolving a row from a position must key on {@link ListingRow.fileOffset}.
   */
  | 'method-relative'
  /**
   * The address is a runtime code address. JIT-generated assembly, whose bytes exist in no file.
   */
  | 'runtime-address';

/**
 * Says what a row is. Present because JIT output interleaves instruction-group labels — which carry the
 * only offsets available — with instructions, which carry none. Modelling labels as rows keeps sections
 * flat, which is what the listing panel needs.
 */
export type ListingRowKind =
  /**
   * A decoded instruction.
   */
  | 'instruction'
  /**
   * A label naming a position within the section, such as a JIT instruction group.
   */
  | 'label'
  /**
   * A free-standing comment line.
   */
  | 'comment';

/**
 * Says where a listing came from, so the panel can caption it honestly and warn when it is stale.
 */
export type ListingOrigin =
  /**
   * Decoded from bytes the renderer holds, so unsaved edits are reflected. Every decoder plugin uses
   * this: decoders are handed bytes, never a path, which is what preserves the invariant.
   */
  | { readonly kind: 'buffer'; readonly path: string | null }
  /**
   * Decoded from a file read off disk, and therefore blind to unsaved edits. Reserved for decoders that
   * genuinely cannot work from a buffer; the panel must say so when the document is dirty.
   */
  | { readonly kind: 'file'; readonly path: string }
  /**
   * Captured from a process that was actually executed, such as JIT assembly.
   */
  | { readonly kind: 'process'; readonly command: string; readonly tier?: string };

/**
 * Describes one row of a listing. Deliberately a superset of {@link DecodedInstruction}, with
 * everything a given decoder cannot supply made optional.
 */
export interface ListingRow {
  /**
   * Gets what this row is. Absent means {@link ListingRowKind.instruction}.
   */
  readonly kind?: ListingRowKind;

  /**
   * Gets the address, interpreted per the listing's {@link CodeListing.addressing}.
   *
   * Optional as a matter of fact rather than convenience: the .NET JIT emits an offset per instruction
   * *group*, never per instruction, so JIT instruction rows have no address to report. Requiring one
   * would mean inventing it.
   */
  readonly address?: number;

  /**
   * Gets the absolute file offset of this row's bytes, when it has any.
   *
   * Kept separate from {@link address} because they are not the same thing, and the difference is what
   * makes cross-highlighting possible: under `method-relative` addressing the address repeats across
   * sections, so only this can identify a row from a byte position. Absent for JIT rows, whose bytes
   * are in no file.
   */
  readonly fileOffset?: number;

  /**
   * Gets the row's raw bytes, when known.
   */
  readonly bytes?: readonly number[];

  /**
   * Gets the mnemonic, such as `mov`, `invokevirtual`, or `ldarg.0`.
   */
  readonly mnemonic: string;

  /**
   * Gets the operands as text, empty when there are none.
   */
  readonly operands: string;

  /**
   * Gets a trailing comment, such as a resolved constant-pool reference or a JIT annotation.
   */
  readonly comment?: string;

  /**
   * Gets the one-based source line this row was generated from, when the decoder had a source mapping
   * (a portable PDB, or a JVM `LineNumberTable`) to read it from.
   */
  readonly sourceLine?: number;
}

/**
 * Describes a contiguous run of rows under one heading — almost always a single method.
 */
export interface ListingSection {
  /**
   * Gets a stable identifier for the section, unique within the listing.
   */
  readonly id: string;

  /**
   * Gets the heading to show, such as `static int add(int, int)`.
   */
  readonly title: string;

  /**
   * Gets the section's byte range in the backing file, when it has one. Present for listings decoded
   * from a file's bytes; absent for JIT output.
   */
  readonly fileRange?: { readonly start: number; readonly length: number };

  /**
   * Gets the absolute path of the source file this section was compiled from, when the decoder could
   * determine it — from a portable PDB, or a JVM `SourceFile` attribute.
   *
   * This is what lets a source-first view show only the methods belonging to the file on screen.
   * Filtering on the section title instead would be guesswork: a partial class spans files, and a
   * nested or generated type's name says nothing about where it was written.
   */
  readonly sourcePath?: string;

  /**
   * Gets per-section annotations to show beneath the heading, such as `Tier0`, `no PGO data`, or
   * `max_stack=2`.
   */
  readonly notes?: readonly string[];

  /**
   * Gets the rows, in listing order.
   */
  readonly rows: readonly ListingRow[];
}

/**
 * Describes a complete listing: how to read its addresses, where it came from, and its sections.
 */
export interface CodeListing {
  /**
   * Gets the language or format label shown in the panel, such as `JVM bytecode`, `.NET IL`, `x64`, or
   * `WebAssembly`.
   */
  readonly language: string;

  /**
   * Gets how to interpret every row's address.
   */
  readonly addressing: ListingAddressing;

  /**
   * Gets where the listing came from.
   */
  readonly origin: ListingOrigin;

  /**
   * Gets the sections, in listing order.
   */
  readonly sections: readonly ListingSection[];
}

/**
 * Builds a listing from flat decoded instructions — the shape the native disassembly path produces.
 * A native listing is one section addressed by file offset, which is why this contract wraps
 * {@link DecodedInstruction} rather than replacing it.
 * @param instructions The decoded instructions.
 * @param language The architecture label to caption the listing with.
 * @param path The file the bytes came from, or null when they came from an unnamed buffer.
 * @returns Returns the listing.
 */
export function listingFromInstructions(
  instructions: readonly DecodedInstruction[],
  language: string,
  path: string | null,
): CodeListing {
  return {
    language,
    addressing: 'file-offset',
    origin: { kind: 'buffer', path },
    sections: [
      {
        id: 'native',
        title: language,
        rows: instructions.map((instruction: DecodedInstruction): ListingRow => ({
          kind: 'instruction',
          address: instruction.startOffset,
          fileOffset: instruction.startOffset,
          bytes: instruction.raw,
          mnemonic: instruction.mnemonic,
          operands: instruction.operands,
        })),
      },
    ],
  };
}

/**
 * Finds the row covering a byte offset, together with the section holding it.
 *
 * Keyed on {@link ListingRow.fileOffset} rather than {@link ListingRow.address} deliberately: under
 * `method-relative` addressing every method's addresses start at zero, so resolving on address alone
 * would always land in the first section. Rows with no file offset — JIT output — are never matched,
 * which is the correct outcome rather than a gap: those bytes are in no file to have been clicked.
 * @param listing The listing to search.
 * @param fileOffset The absolute file offset to locate.
 * @returns Returns the section and row covering the offset, or null when none does.
 */
export function rowAtFileOffset(
  listing: CodeListing,
  fileOffset: number,
): { readonly section: ListingSection; readonly row: ListingRow } | null {
  for (const section of listing.sections) {
    for (const row of section.rows) {
      if (row.fileOffset === undefined) {
        continue;
      }
      const length: number = row.bytes?.length ?? 0;
      if (row.fileOffset <= fileOffset && fileOffset < row.fileOffset + Math.max(length, 1)) {
        return { section, row };
      }
    }
  }
  return null;
}

/**
 * Counts the rows across every section, so a caller can size a listing without flattening it.
 * @param listing The listing to measure.
 * @returns Returns the total row count.
 */
export function listingRowCount(listing: CodeListing): number {
  return listing.sections.reduce(
    (total: number, section: ListingSection): number => total + section.rows.length,
    0,
  );
}
