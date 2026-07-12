import { inject, Service } from '@angular/core';
import {
  DELETE_BINARY_BYTES,
  INSERT_BINARY_BYTES,
  PATCH_BINARY_BYTES,
  READ_BINARY_BYTES,
  READ_BINARY_DISASSEMBLY,
  READ_BINARY_OVERVIEW,
  READ_BINARY_SELECTION,
  WRITE_BINARY_ASSEMBLY,
} from '@shared/api/ai-types';
import { AssembleResult, DecodedInstruction } from '@shared/api/binary-channels';
import { AiRuntime } from '@shared/angular/services/ai-runtime/ai-runtime';
import {
  BinaryDocumentEntry,
  BinaryDocuments,
  BinarySelection,
} from '../binary-document/binary-document';
import { describeFormat, disassemblyArchitecture } from '../binary-format/binary-format';

/**
 * The result of a binary read capability: whether a binary document was available to read, and the
 * rendered text (the hex/ASCII/assembly dump, an overview, or a note) for the model.
 */
interface ReadResult {
  /**
   * Gets a value indicating whether a binary document was available to read.
   */
  readonly available: boolean;

  /**
   * Gets the rendered text (empty when none was available).
   */
  readonly text: string;
}

/**
 * The result of the byte-patching capability: whether the bytes were written, and a message for the
 * model describing the outcome.
 */
interface PatchResult {
  /**
   * Gets a value indicating whether the bytes were overwritten.
   */
  readonly ok: boolean;

  /**
   * Gets a message describing the outcome (a confirmation, or the reason the patch was rejected).
   */
  readonly text: string;
}

/**
 * Holds the largest number of bytes a single read (hex dump or disassembly window) returns, so a tool
 * call never floods the transcript however large a range the model asks for.
 */
const MAX_READ_BYTES: number = 4096;

/**
 * Holds how many bytes are shown per row in a hex dump.
 */
const DUMP_ROW: number = 16;

/**
 * Registers the agent's in-app binary capabilities with the {@link AiRuntime} registry: reading the
 * open binary document's overview, hex/ASCII bytes, selection, and disassembly, and patching its
 * bytes. The main-process agent providers invoke these by name over the renderer bridge for a
 * binary-surface run. Instantiated eagerly at start-up (see the binary feature's app initializer) so
 * the capabilities are available whenever a binary agent runs. The hex/ASCII/assembly formatting lives
 * here, so the main-process tool handlers only relay the rendered text.
 */
@Service()
export class BinaryAgentCapabilities {
  /**
   * Holds the agent runtime the capabilities register with.
   */
  private readonly runtime: AiRuntime = inject(AiRuntime);

  /**
   * Holds the binary document registry the capabilities resolve the owning document from.
   */
  private readonly binaryDocuments: BinaryDocuments = inject(BinaryDocuments);

  /**
   * Initializes a new instance of the {@link BinaryAgentCapabilities} class, registering the binary
   * capabilities.
   */
  public constructor() {
    this.runtime.registerCapability(
      READ_BINARY_OVERVIEW,
      (input: unknown): Promise<ReadResult> => this.overview(input),
    );
    this.runtime.registerCapability(
      READ_BINARY_BYTES,
      (input: unknown): Promise<ReadResult> => this.readBytes(input),
    );
    this.runtime.registerCapability(
      READ_BINARY_SELECTION,
      (input: unknown): Promise<ReadResult> => this.readSelection(input),
    );
    this.runtime.registerCapability(
      READ_BINARY_DISASSEMBLY,
      (input: unknown): Promise<ReadResult> => this.readDisassembly(input),
    );
    this.runtime.registerCapability(
      PATCH_BINARY_BYTES,
      (input: unknown): Promise<PatchResult> => this.patch(input),
    );
    this.runtime.registerCapability(
      INSERT_BINARY_BYTES,
      (input: unknown): Promise<PatchResult> => this.insert(input),
    );
    this.runtime.registerCapability(
      DELETE_BINARY_BYTES,
      (input: unknown): Promise<PatchResult> => this.delete(input),
    );
    this.runtime.registerCapability(
      WRITE_BINARY_ASSEMBLY,
      (input: unknown): Promise<PatchResult> => this.writeAssembly(input),
    );
  }

  /**
   * Reports an overview of the owning binary document: path, size, format, architecture, whether
   * disassembly is available, and the current cursor/selection.
   * @param input The capability input, carrying the owning `tabId`.
   * @returns Returns the {@link ReadResult}.
   */
  private async overview(input: unknown): Promise<ReadResult> {
    const document: BinaryDocumentEntry | undefined = this.resolve(input);
    if (document === undefined) {
      return { available: false, text: '' };
    }
    await document.whenReady();
    const architecture: string | null = disassemblyArchitecture(document.format());
    const cursor: number | null = document.cursor();
    const selection: BinarySelection | null = document.selection();
    const lines: string[] = [
      `File: ${document.fileName} (${document.path})`,
      `Size: ${document.size()} bytes`,
      `Format: ${describeFormat(document.format())}`,
      architecture === null
        ? 'Disassembly: not available for this format'
        : `Disassembly: available (${architecture})`,
      cursor === null ? 'Cursor: none' : `Cursor: ${this.hexOffset(cursor)} (${cursor})`,
      selection === null
        ? 'Selection: none'
        : `Selection: ${this.hexOffset(selection.start)}–${this.hexOffset(selection.end)} (${selection.end - selection.start} bytes)`,
      `Unsaved edits: ${document.dirty() ? 'yes' : 'no'}`,
    ];
    return { available: true, text: lines.join('\n') };
  }

  /**
   * Reads a hex + ASCII dump of a byte range from a `{ tabId, offset, length }` input.
   * @param input The capability input.
   * @returns Returns the {@link ReadResult}.
   */
  private async readBytes(input: unknown): Promise<ReadResult> {
    const document: BinaryDocumentEntry | undefined = this.resolve(input);
    if (document === undefined) {
      return { available: false, text: '' };
    }
    const offset: number = Math.max(0, this.extractNumber(input, 'offset') ?? 0);
    const length: number = this.clampLength(this.extractNumber(input, 'length') ?? 256);
    return { available: true, text: await this.dumpRange(document, offset, length) };
  }

  /**
   * Reads a hex + ASCII dump of the owning document's current selection.
   * @param input The capability input, carrying the owning `tabId`.
   * @returns Returns the {@link ReadResult}.
   */
  private async readSelection(input: unknown): Promise<ReadResult> {
    const document: BinaryDocumentEntry | undefined = this.resolve(input);
    if (document === undefined) {
      return { available: false, text: '' };
    }
    const selection: BinarySelection | null = document.selection();
    if (selection === null || selection.end <= selection.start) {
      return { available: true, text: 'Nothing is selected.' };
    }
    const length: number = this.clampLength(selection.end - selection.start);
    return { available: true, text: await this.dumpRange(document, selection.start, length) };
  }

  /**
   * Reads the assembly listing for a byte range from a `{ tabId, offset, length }` input.
   * @param input The capability input.
   * @returns Returns the {@link ReadResult}.
   */
  private async readDisassembly(input: unknown): Promise<ReadResult> {
    const document: BinaryDocumentEntry | undefined = this.resolve(input);
    if (document === undefined) {
      return { available: false, text: '' };
    }
    const offset: number = Math.max(0, this.extractNumber(input, 'offset') ?? 0);
    const length: number = this.clampLength(this.extractNumber(input, 'length') ?? 256);
    const instructions: readonly DecodedInstruction[] | null = await document.disassembleRange(
      offset,
      length,
    );
    if (instructions === null) {
      return {
        available: true,
        text: `Disassembly is not available for this format (${describeFormat(document.format())}).`,
      };
    }
    if (instructions.length === 0) {
      return { available: true, text: 'No instructions were decoded in this range.' };
    }
    return { available: true, text: this.listInstructions(instructions) };
  }

  /**
   * Overwrites bytes at an offset from a `{ tabId, offset, bytes }` input, where `bytes` is a hex
   * string. Produces an unsaved, undoable edit.
   * @param input The capability input.
   * @returns Returns the {@link PatchResult}.
   */
  private async patch(input: unknown): Promise<PatchResult> {
    const document: BinaryDocumentEntry | undefined = this.resolve(input);
    if (document === undefined) {
      return { ok: false, text: 'No binary document is open in this view.' };
    }
    const offset: number | null = this.extractNumber(input, 'offset');
    const values: number[] | null = this.parseHex(this.extractString(input, 'bytes'));
    if (offset === null || offset < 0) {
      return { ok: false, text: 'A non-negative byte offset is required.' };
    }
    if (values === null || values.length === 0) {
      return { ok: false, text: 'The bytes must be a non-empty hex string, e.g. "4d 5a".' };
    }
    const ok: boolean = await document.patch(offset, values);
    if (!ok) {
      return {
        ok: false,
        text: `Cannot patch ${values.length} byte(s) at ${this.hexOffset(offset)}: the range is outside the file (size ${document.size()} bytes). Patching cannot change the file length.`,
      };
    }
    return {
      ok: true,
      text: `Overwrote ${values.length} byte(s) at ${this.hexOffset(offset)}. The change is unsaved and undoable; the user can save it to write it to disk.`,
    };
  }

  /**
   * Inserts bytes before an offset from a `{ tabId, offset, bytes }` input, where `bytes` is a hex
   * string. Grows the document and shifts every subsequent offset; produces an unsaved, undoable edit.
   * @param input The capability input.
   * @returns Returns the {@link PatchResult}.
   */
  private async insert(input: unknown): Promise<PatchResult> {
    const document: BinaryDocumentEntry | undefined = this.resolve(input);
    if (document === undefined) {
      return { ok: false, text: 'No binary document is open in this view.' };
    }
    const offset: number | null = this.extractNumber(input, 'offset');
    const values: number[] | null = this.parseHex(this.extractString(input, 'bytes'));
    if (offset === null || offset < 0) {
      return { ok: false, text: 'A non-negative byte offset is required.' };
    }
    if (values === null || values.length === 0) {
      return { ok: false, text: 'The bytes must be a non-empty hex string, e.g. "4d 5a".' };
    }
    const ok: boolean = await document.insertBytes(offset, values);
    if (!ok) {
      return {
        ok: false,
        text: `Cannot insert at ${this.hexOffset(offset)}: the offset is outside the file (size ${document.size()} bytes; inserting at the size appends).`,
      };
    }
    return {
      ok: true,
      text: `Inserted ${values.length} byte(s) at ${this.hexOffset(offset)}. The file is now ${document.size()} bytes and every offset at or after ${this.hexOffset(offset)} has shifted by +${values.length} — earlier reads are stale. The change is unsaved and undoable.`,
    };
  }

  /**
   * Deletes a run of bytes from a `{ tabId, offset, length }` input. Shrinks the document and shifts
   * every subsequent offset; produces an unsaved, undoable edit.
   * @param input The capability input.
   * @returns Returns the {@link PatchResult}.
   */
  private async delete(input: unknown): Promise<PatchResult> {
    const document: BinaryDocumentEntry | undefined = this.resolve(input);
    if (document === undefined) {
      return { ok: false, text: 'No binary document is open in this view.' };
    }
    const offset: number | null = this.extractNumber(input, 'offset');
    const length: number | null = this.extractNumber(input, 'length');
    if (offset === null || offset < 0) {
      return { ok: false, text: 'A non-negative byte offset is required.' };
    }
    if (length === null || length <= 0 || !Number.isInteger(length)) {
      return { ok: false, text: 'A positive whole number of bytes to delete is required.' };
    }
    const ok: boolean = await document.removeBytes(offset, length);
    if (!ok) {
      return {
        ok: false,
        text: `Cannot delete ${length} byte(s) at ${this.hexOffset(offset)}: the range is outside the file (size ${document.size()} bytes).`,
      };
    }
    return {
      ok: true,
      text: `Deleted ${length} byte(s) at ${this.hexOffset(offset)}. The file is now ${document.size()} bytes and every offset at or after ${this.hexOffset(offset)} has shifted by -${length} — earlier reads are stale. The change is unsaved and undoable.`,
    };
  }

  /**
   * Assembles assembly text and writes it over a byte range from a `{ tabId, offset, assembly, length? }`
   * input. The file length is never changed: when the assembled bytes are shorter than the replaced
   * range they are padded with architecture-appropriate NOPs, and when they are longer the write is
   * rejected (growing the file would shift the following code). Produces an unsaved, undoable edit and
   * echoes the round-trip disassembly of what landed.
   * @param input The capability input.
   * @returns Returns the {@link PatchResult}.
   */
  private async writeAssembly(input: unknown): Promise<PatchResult> {
    const document: BinaryDocumentEntry | undefined = this.resolve(input);
    if (document === undefined) {
      return { ok: false, text: 'No binary document is open in this view.' };
    }
    await document.whenReady();
    const offset: number | null = this.extractNumber(input, 'offset');
    const assembly: string | null = this.extractString(input, 'assembly');
    const length: number | null = this.extractNumber(input, 'length');
    if (offset === null || offset < 0) {
      return { ok: false, text: 'A non-negative byte offset is required.' };
    }
    if (assembly === null || assembly.trim().length === 0) {
      return {
        ok: false,
        text: 'The assembly must be a non-empty string, e.g. "mov eax, 1; ret".',
      };
    }
    if (length !== null && (!Number.isInteger(length) || length <= 0)) {
      return { ok: false, text: 'When given, length must be a positive whole number of bytes.' };
    }
    const architecture: string | null = disassemblyArchitecture(document.format());
    if (architecture === null) {
      return {
        ok: false,
        text: `Assembly is not available for this format (${describeFormat(document.format())}).`,
      };
    }
    const assembled: AssembleResult = await document.assemble(assembly, architecture, offset);
    if (!assembled.ok) {
      return { ok: false, text: `Could not assemble the instructions: ${assembled.error}` };
    }
    const written: number[] | string = await this.fit(
      document,
      architecture,
      offset,
      [...assembled.bytes],
      length ?? assembled.bytes.length,
    );
    if (typeof written === 'string') {
      return { ok: false, text: written };
    }
    const ok: boolean = await document.patch(offset, written);
    if (!ok) {
      return {
        ok: false,
        text: `Cannot write ${written.length} byte(s) at ${this.hexOffset(offset)}: the range is outside the file (size ${document.size()} bytes). Assembly cannot change the file length.`,
      };
    }
    return { ok: true, text: await this.describeWrite(document, offset, assembled.bytes, written) };
  }

  /**
   * Fits assembled bytes to the replaced range without changing the file length: returns them unchanged
   * when they match, NOP-padded when shorter, or an explanatory rejection string when they are longer
   * than the range or cannot be padded to it in whole NOPs.
   * @param document The binary document.
   * @param architecture The architecture label (for the NOP encoding).
   * @param offset The write offset (the NOP is assembled at it; its encoding is address-independent).
   * @param assembled The assembled bytes.
   * @param replaced The number of bytes the write must occupy.
   * @returns Returns the fitted bytes, or a rejection message.
   */
  private async fit(
    document: BinaryDocumentEntry,
    architecture: string,
    offset: number,
    assembled: number[],
    replaced: number,
  ): Promise<number[] | string> {
    if (assembled.length > replaced) {
      return `The assembly is ${assembled.length} byte(s) but the target range is ${replaced} byte(s); assembly cannot grow the file (it would shift the following code). Shorten the instructions, or widen the range to at least ${assembled.length} bytes if the following bytes are expendable.`;
    }
    if (assembled.length === replaced) {
      return assembled;
    }
    const nop: AssembleResult = await document.assemble('nop', architecture, offset);
    if (!nop.ok || nop.bytes.length === 0) {
      return `Cannot pad the ${replaced - assembled.length} spare byte(s): no NOP encoding is available for the ${architecture} architecture.`;
    }
    const gap: number = replaced - assembled.length;
    if (gap % nop.bytes.length !== 0) {
      return `Cannot pad ${gap} spare byte(s) with ${nop.bytes.length}-byte NOPs; choose a range length that leaves a whole number of NOPs (a multiple of ${nop.bytes.length} bytes after the instructions).`;
    }
    const padded: number[] = [...assembled];
    for (let count: number = 0; count < gap / nop.bytes.length; count += 1) {
      padded.push(...nop.bytes);
    }
    return padded;
  }

  /**
   * Describes a successful assembly write for the model: the bytes that landed (noting any NOP
   * padding) and the round-trip disassembly of the written range, so the model sees exactly what it
   * wrote.
   * @param document The binary document.
   * @param offset The write offset.
   * @param assembled The bytes the assembler produced (before any padding).
   * @param written The bytes actually written (assembled plus any NOP padding).
   * @returns Returns the confirmation text.
   */
  private async describeWrite(
    document: BinaryDocumentEntry,
    offset: number,
    assembled: readonly number[],
    written: readonly number[],
  ): Promise<string> {
    const hex: string = written
      .map((value: number): string => value.toString(16).padStart(2, '0'))
      .join(' ');
    const padding: number = written.length - assembled.length;
    const note: string =
      padding > 0 ? ` (${assembled.length} assembled + ${padding} NOP-pad byte(s))` : '';
    const instructions: readonly DecodedInstruction[] | null = await document.disassembleRange(
      offset,
      written.length,
    );
    const listing: string =
      instructions !== null && instructions.length > 0
        ? this.listInstructions(instructions)
        : '(the written range did not disassemble)';
    return [
      `Assembled and wrote ${written.length} byte(s) at ${this.hexOffset(offset)}${note}: ${hex}.`,
      'The written range now disassembles as:',
      listing,
      'The change is unsaved and undoable; the user can save it to write it to disk.',
    ].join('\n');
  }

  /**
   * Reads a byte range and renders it as a hex + ASCII dump, noting when the read was clamped or the
   * range ran past the end of the file.
   * @param document The binary document.
   * @param offset The first byte offset to read.
   * @param length The number of bytes to read (already clamped).
   * @returns Returns the rendered dump.
   */
  private async dumpRange(
    document: BinaryDocumentEntry,
    offset: number,
    length: number,
  ): Promise<string> {
    const bytes: number[] = await document.readBytes(offset, length);
    if (bytes.length === 0) {
      return `No bytes are available at ${this.hexOffset(offset)} (file size ${document.size()} bytes).`;
    }
    const note: string = `\n\n(${bytes.length} byte(s) from ${this.hexOffset(offset)}; file size ${document.size()} bytes.)`;
    return this.hexDump(bytes, offset) + note;
  }

  /**
   * Formats bytes as a classic hex + ASCII dump: an 8-digit hex address, sixteen hex byte columns
   * (split into two groups of eight), and the printable-ASCII rendering of the row.
   * @param bytes The bytes to render.
   * @param base The file offset of the first byte.
   * @returns Returns the multi-line dump.
   */
  private hexDump(bytes: readonly number[], base: number): string {
    const rows: string[] = [];
    for (let start: number = 0; start < bytes.length; start += DUMP_ROW) {
      const address: string = (base + start).toString(16).padStart(8, '0').toUpperCase();
      let hex: string = '';
      let ascii: string = '';
      for (let column: number = 0; column < DUMP_ROW; column += 1) {
        if (column === 8) {
          hex += ' ';
        }
        const index: number = start + column;
        if (index < bytes.length) {
          const value: number = bytes[index];
          hex += `${value.toString(16).padStart(2, '0').toUpperCase()} `;
          ascii += value >= 0x20 && value <= 0x7e ? String.fromCharCode(value) : '.';
        } else {
          hex += '   ';
        }
      }
      rows.push(`${address}  ${hex} |${ascii}|`);
    }
    return rows.join('\n');
  }

  /**
   * Renders decoded instructions as an assembly listing: an 8-digit hex address, the mnemonic, and the
   * operands, one instruction per line.
   * @param instructions The decoded instructions.
   * @returns Returns the multi-line listing.
   */
  private listInstructions(instructions: readonly DecodedInstruction[]): string {
    return instructions
      .map((instruction: DecodedInstruction): string => {
        const address: string = instruction.startOffset.toString(16).padStart(8, '0').toUpperCase();
        const operands: string = instruction.operands.length > 0 ? ` ${instruction.operands}` : '';
        return `${address}  ${instruction.mnemonic}${operands}`;
      })
      .join('\n');
  }

  /**
   * Parses a hex string into byte values, tolerating whitespace, commas, and `0x` prefixes. Returns
   * null when the input is absent or not a valid, whole sequence of bytes.
   * @param value The hex string, or null.
   * @returns Returns the parsed bytes, or null when malformed.
   */
  private parseHex(value: string | null): number[] | null {
    if (value === null) {
      return null;
    }
    const cleaned: string = value.replace(/0x/gi, '').replace(/[\s,]+/g, '');
    if (cleaned.length === 0 || cleaned.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(cleaned)) {
      return null;
    }
    const bytes: number[] = [];
    for (let index: number = 0; index < cleaned.length; index += 2) {
      bytes.push(parseInt(cleaned.slice(index, index + 2), 16));
    }
    return bytes;
  }

  /**
   * Clamps a requested read length to a positive value no larger than {@link MAX_READ_BYTES}.
   * @param length The requested length.
   * @returns Returns the clamped length.
   */
  private clampLength(length: number): number {
    return Math.max(1, Math.min(Math.floor(length), MAX_READ_BYTES));
  }

  /**
   * Formats a byte offset as a hex address for display.
   * @param offset The byte offset.
   * @returns Returns the `0x`-prefixed uppercase hex offset.
   */
  private hexOffset(offset: number): string {
    return `0x${offset.toString(16).toUpperCase()}`;
  }

  /**
   * Resolves the owning binary document from a capability input carrying the owning `tabId`.
   * @param input The capability input.
   * @returns Returns the document, or undefined when the tab has none.
   */
  private resolve(input: unknown): BinaryDocumentEntry | undefined {
    const tabId: string | null = this.extractString(input, 'tabId');
    return tabId === null ? undefined : this.binaryDocuments.get(tabId);
  }

  /**
   * Extracts a string field from a capability input.
   * @param input The capability input.
   * @param key The field to read.
   * @returns Returns the string value, or null when absent or malformed.
   */
  private extractString(input: unknown, key: string): string | null {
    if (input === null || typeof input !== 'object') {
      return null;
    }
    const value: unknown = (input as Record<string, unknown>)[key];
    return typeof value === 'string' ? value : null;
  }

  /**
   * Extracts a finite number field from a capability input.
   * @param input The capability input.
   * @param key The field to read.
   * @returns Returns the number value, or null when absent or malformed.
   */
  private extractNumber(input: unknown, key: string): number | null {
    if (input === null || typeof input !== 'object') {
      return null;
    }
    const value: unknown = (input as Record<string, unknown>)[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }
}
