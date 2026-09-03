// The wire shapes a decoder plugin emits.
//
// Deliberately declared here rather than imported from the application's `@shared/api`: a decoder is a
// separate program whose contract with Studio is the protocol, not shared TypeScript. A third-party
// decoder would write these types from the documented protocol, and a first-party one taking a
// shortcut into `src/` would quietly make itself unextractable — and would let a change in the app
// break a shipped plugin without anything noticing.
//
// This module is bundled into each decoder, so every plugin artefact stays self-contained. It is the
// in-repo stand-in for what would eventually be a published protocol package.

/**
 * Says what a row's address means.
 */
export type ListingAddressing = 'file-offset' | 'method-relative' | 'runtime-address';

/**
 * Says what a row is. Absent means an instruction.
 */
export type ListingRowKind = 'instruction' | 'label' | 'comment';

/**
 * Describes one row of a listing.
 */
export interface ListingRow {
  readonly kind?: ListingRowKind;

  /**
   * The address, interpreted per the listing's addressing. Absent when the decoder genuinely has none
   * to report rather than as a default.
   */
  readonly address?: number;

  /**
   * The absolute file offset of this row's bytes. Drives cross-highlighting, and is separate from
   * `address` because a method-relative address repeats across sections.
   */
  readonly fileOffset?: number;

  readonly bytes?: readonly number[];
  readonly mnemonic: string;
  readonly operands: string;
  readonly comment?: string;
  readonly sourceLine?: number;
}

/**
 * Describes a contiguous run of rows under one heading — almost always a method.
 */
export interface ListingSection {
  readonly id: string;
  readonly title: string;
  readonly fileRange?: { readonly start: number; readonly length: number };
  readonly notes?: readonly string[];
  readonly rows: readonly ListingRow[];
}

/**
 * Describes a complete listing.
 */
export interface CodeListing {
  readonly language: string;
  readonly addressing: ListingAddressing;
  readonly origin:
    | { readonly kind: 'buffer'; readonly path: string | null }
    | { readonly kind: 'file'; readonly path: string }
    | { readonly kind: 'process'; readonly command: string; readonly tier?: string };
  readonly sections: readonly ListingSection[];
}

/**
 * Describes what a decoder says it is, in answer to a describe request.
 */
export interface DecoderDescription {
  readonly protocol: string;
  readonly formats: readonly string[];
  readonly requiresWholeFile: boolean;
}

/**
 * Holds the protocol version these plugins speak.
 */
export const PROTOCOL_VERSION: string = '1.0';

/**
 * Answers one parsed request with the response object to write back. Returning a promise is allowed so
 * a decoder that must do asynchronous work does not have to fake being synchronous.
 */
export type DecoderHandler = (request: Record<string, unknown>) => unknown;

/**
 * Runs a decoder's request loop over standard streams.
 *
 * Buffered across chunks: a chunk boundary falls wherever the pipe decides, so a request routinely
 * arrives in two pieces and parsing per chunk would drop every one that did.
 * @param handle Answers one parsed request, returning the response object to write back.
 */
export function serve(handle: DecoderHandler): void {
  let buffer: string = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk: string): void => {
    buffer += chunk;
    let newline: number = buffer.indexOf('\n');
    while (newline !== -1) {
      const line: string = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line.length > 0) {
        void answer(line, handle);
      }
      newline = buffer.indexOf('\n');
    }
  });
  process.stdin.on('end', (): void => process.exit(0));
}

/**
 * Answers one request line, turning a thrown error into a refusal rather than a crash.
 * @param line The request line.
 * @param handle The request handler.
 */
async function answer(line: string, handle: DecoderHandler): Promise<void> {
  let response: unknown;
  let id: number = 0;
  try {
    const request: Record<string, unknown> = JSON.parse(line) as Record<string, unknown>;
    id = typeof request['id'] === 'number' ? request['id'] : 0;
    response = await handle(request);
  } catch (error: unknown) {
    response = { id, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  process.stdout.write(`${JSON.stringify(response)}\n`);
}
