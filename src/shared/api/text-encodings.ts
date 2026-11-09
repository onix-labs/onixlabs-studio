// The text encodings Studio reads and writes files in (#1236), shared by the renderer, which shows and
// chooses them, and the main process, which decodes and encodes the bytes.

/**
 * Names a text encoding Studio can read and write a file in.
 */
export type TextEncoding = 'utf8' | 'utf16le' | 'utf16be' | 'windows1252' | 'iso88591';

/**
 * Lists every {@link TextEncoding}, in the order they are offered.
 */
export const TEXT_ENCODINGS: readonly TextEncoding[] = [
  'utf8',
  'utf16le',
  'utf16be',
  'windows1252',
  'iso88591',
];

/**
 * Holds how each encoding is named to the user.
 */
const LABELS: Readonly<Record<TextEncoding, string>> = {
  utf8: 'UTF-8',
  utf16le: 'UTF-16 LE',
  utf16be: 'UTF-16 BE',
  windows1252: 'Windows 1252',
  iso88591: 'ISO 8859-1',
};

/**
 * Determines whether a value is a {@link TextEncoding}.
 * @param value The value, untrusted.
 * @returns Returns true when it names an encoding Studio knows.
 */
export function isTextEncoding(value: unknown): value is TextEncoding {
  return typeof value === 'string' && (TEXT_ENCODINGS as readonly string[]).includes(value);
}

/**
 * Names an encoding for the user, as the status strip and its menu show it.
 * @param encoding The encoding.
 * @param bom Whether the file carries a byte-order mark; shown only for UTF-8, where it is optional.
 * @returns Returns the label, such as "UTF-8 with BOM".
 */
export function encodingLabel(encoding: TextEncoding, bom: boolean = false): string {
  return encoding === 'utf8' && bom ? 'UTF-8 with BOM' : LABELS[encoding];
}

/**
 * Describes how the bytes of a file are to be decoded.
 */
export interface TextDecodeOptions {
  /**
   * Gets the encoding to decode with whatever the bytes suggest (Reopen with Encoding), or undefined
   * to tell it from the bytes.
   */
  readonly encoding?: TextEncoding;

  /**
   * Gets the encoding used when it cannot be told from the bytes (Default Encoding), or undefined for
   * UTF-8.
   */
  readonly fallback?: TextEncoding;

  /**
   * Gets whether the encoding is told from the bytes beyond a byte-order mark — UTF-8 when they are
   * valid UTF-8 (Auto-Detect Encoding). Undefined means yes.
   */
  readonly autoDetect?: boolean;
}

/**
 * Reads decode options from the renderer, which is untrusted: anything not understood is dropped, so
 * a malformed request decodes as it would with none.
 * @param value The options asked for.
 * @returns Returns the options understood.
 */
export function textDecodeOptions(value: unknown): TextDecodeOptions {
  if (typeof value !== 'object' || value === null) {
    return {};
  }
  const { encoding, fallback, autoDetect } = value as Record<string, unknown>;
  return {
    ...(isTextEncoding(encoding) ? { encoding } : {}),
    ...(isTextEncoding(fallback) ? { fallback } : {}),
    ...(typeof autoDetect === 'boolean' ? { autoDetect } : {}),
  };
}
