import { CodeListing } from './code-listing';

// The decoder protocol shared between the Electron main process and every decoder plugin. Keep this
// module platform-neutral (no Node or DOM dependencies) so both compilation targets can import it.
//
// Every decoder — native machine code, JVM bytecode, WebAssembly, .NET IL — is a plugin the user
// installs, and every one of them speaks this. Studio ships no decoder of its own.
//
// The transport is newline-delimited JSON over standard streams: one request object per line in, one
// response object per line out, correlated by `id`. A decoder is long-running for the session rather
// than spawned per request, so a runtime's start-up cost is paid once.
//
// A decoder is handed BYTES, never a path. That is what preserves the invariant the binary editor
// already relies on — the renderer sends the bytes it is displaying, so unsaved edits decode
// correctly — and it is why every listing a decoder returns has a `buffer` origin.

/**
 * Holds the protocol version this build speaks. A decoder announcing a different major version is
 * refused rather than spoken to, because a decoder that misunderstands a byte range returns a listing
 * that is wrong rather than absent, and wrong is worse.
 */
export const DECODER_PROTOCOL_VERSION: string = '1.0';

/**
 * Names the canonical format keys a decoder claims in its manifest, and that the registry resolves
 * against.
 *
 * Closed and canonical on purpose: a key is the join between what a sniffer detects and what a plugin
 * says it decodes, so the two must be spelled the same or a decoder silently never matches. An
 * architecture-bearing key is `<container>/<architecture>`; a container whose architecture does not
 * vary is named alone.
 */
export const DECODER_FORMATS: readonly string[] = [
  'pe/x86',
  'pe/x64',
  'pe/arm',
  'pe/arm64',
  'pe-managed',
  'mz/x86-16',
  'elf/x86',
  'elf/x64',
  'elf/arm',
  'elf/arm64',
  'elf/riscv',
  'macho/x86',
  'macho/x64',
  'macho/arm',
  'macho/arm64',
  'jvm',
  'wasm',
];

/**
 * Builds the canonical format key for a container and architecture, so the sniffer and a manifest name
 * the same thing. Architecture is lower-cased because a key is compared exactly and the sniffer's
 * labels are capitalised for display (`ARM64`), which is a presentation choice rather than an identity.
 * @param container The container kind, such as `pe`, `elf`, `macho`, `jvm`, or `wasm`.
 * @param architecture The architecture label, or undefined for a container whose architecture is fixed.
 * @returns Returns the format key.
 */
export function decoderFormatKey(container: string, architecture?: string): string {
  return architecture === undefined
    ? container
    : `${container}/${architecture.toLowerCase().replace('risc-v', 'riscv')}`;
}

/**
 * Asks a decoder what it is and what it can do. Sent once, immediately after the process starts, before
 * any decode is attempted.
 */
export interface DecoderDescribeRequest {
  /**
   * Gets the request correlation identifier.
   */
  readonly id: number;

  /**
   * Discriminates the request.
   */
  readonly op: 'describe';
}

/**
 * Asks a decoder to decode a range of bytes into a listing.
 */
export interface DecoderDecodeRequest {
  /**
   * Gets the request correlation identifier.
   */
  readonly id: number;

  /**
   * Discriminates the request.
   */
  readonly op: 'decode';

  /**
   * Gets the format key the caller resolved this decoder for, so a decoder claiming several formats
   * knows which one it is being asked about.
   */
  readonly format: string;

  /**
   * Gets the bytes to decode, base64-encoded. Base64 rather than an array of numbers because a byte
   * array of any size is several times larger as JSON, and this is the hot path.
   */
  readonly bytes: string;

  /**
   * Gets the absolute file offset of the first supplied byte, so the listing's file offsets are
   * absolute rather than relative to the window.
   */
  readonly baseOffset: number;

  /**
   * Gets the total size of the file the bytes came from, when the caller supplied a window rather than
   * the whole file. A decoder needing random access over the whole file — .NET metadata does — refuses
   * a partial window rather than guessing.
   */
  readonly totalSize?: number;

  /**
   * Gets the path the bytes came from, for display only. A decoder must not read it: the bytes it was
   * handed are authoritative, and may differ from what is on disk.
   */
  readonly path?: string;
}

/**
 * Describes a request sent to a decoder.
 */
export type DecoderRequest = DecoderDescribeRequest | DecoderDecodeRequest;

/**
 * Describes what a decoder says it is, in answer to a describe request.
 */
export interface DecoderDescription {
  /**
   * Gets the protocol version the decoder speaks.
   */
  readonly protocol: string;

  /**
   * Gets the format keys the decoder actually supports, which the registry checks against what the
   * manifest claimed. A manifest is a promise; this is the decoder itself answering.
   */
  readonly formats: readonly string[];

  /**
   * Gets a value indicating whether the decoder needs the whole file rather than a window. True for
   * decoders whose format requires random access, such as .NET metadata.
   */
  readonly requiresWholeFile: boolean;
}

/**
 * Describes a decoder's answer to a request: the payload on success, or the reason it failed.
 */
export type DecoderResponse =
  | {
      /**
       * Gets the correlation identifier of the request this answers.
       */
      readonly id: number;

      /**
       * Discriminates the success case.
       */
      readonly ok: true;

      /**
       * Gets the decoder's self-description, present for a describe request.
       */
      readonly description?: DecoderDescription;

      /**
       * Gets the decoded listing, present for a decode request.
       */
      readonly listing?: CodeListing;
    }
  | {
      /**
       * Gets the correlation identifier of the request this answers.
       */
      readonly id: number;

      /**
       * Discriminates the failure case.
       */
      readonly ok: false;

      /**
       * Gets a human-readable reason the request failed, suitable for showing in the panel.
       */
      readonly error: string;
    };

/**
 * Determines whether a decoder's announced protocol version is compatible with this build's.
 *
 * Compatibility is major-version equality: a decoder may add minor capability without Studio knowing,
 * but a major difference means the two disagree about the shape of a request, and a decoder that
 * misreads a byte range produces a plausible wrong answer rather than an obvious failure.
 * @param announced The version the decoder announced.
 * @returns Returns true when the decoder may be spoken to.
 */
export function isCompatibleProtocol(announced: string): boolean {
  const major: (version: string) => string = (version: string): string => version.split('.')[0];
  return major(announced) === major(DECODER_PROTOCOL_VERSION);
}
