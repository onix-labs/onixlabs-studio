import { inject, Service } from '@angular/core';
import {
  PATCH_BINARY_BYTES,
  READ_BINARY_BYTES,
  READ_BINARY_DISASSEMBLY,
  READ_BINARY_OVERVIEW,
  READ_BINARY_SELECTION,
} from '@shared/api/ai-types';
import { DecodedInstruction } from '@shared/api/binary-channels';
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
