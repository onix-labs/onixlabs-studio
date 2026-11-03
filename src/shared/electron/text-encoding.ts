import {
  encodingLabel,
  type TextDecodeOptions,
  type TextEncoding,
} from '@shared/api/text-encodings';

/**
 * Holds the UTF-8 byte-order mark.
 */
const UTF8_BOM: readonly number[] = [0xef, 0xbb, 0xbf];

/**
 * Holds the UTF-16 little-endian byte-order mark.
 */
const UTF16LE_BOM: readonly number[] = [0xff, 0xfe];

/**
 * Holds the UTF-16 big-endian byte-order mark.
 */
const UTF16BE_BOM: readonly number[] = [0xfe, 0xff];

/**
 * Holds the characters Windows 1252 puts in bytes 0x80–0x9F, where it differs from ISO 8859-1. The
 * five bytes it leaves undefined (0x81, 0x8D, 0x8F, 0x90, 0x9D) decode as the C1 control of the same
 * number, as browsers decode them, so they round-trip.
 */
const WINDOWS_1252_HIGH: readonly number[] = [
  0x20ac, 0x0081, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039,
  0x0152, 0x008d, 0x017d, 0x008f, 0x0090, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014,
  0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x009d, 0x017e, 0x0178,
];

/**
 * Holds the Windows 1252 byte for each character of {@link WINDOWS_1252_HIGH}.
 */
const WINDOWS_1252_BYTES: ReadonlyMap<number, number> = new Map<number, number>(
  WINDOWS_1252_HIGH.map((codePoint: number, index: number): [number, number] => [
    codePoint,
    0x80 + index,
  ]),
);

/**
 * Describes a decoded file: its text, the encoding it was read in, and whether it began with that
 * encoding's byte-order mark.
 */
export interface DecodedText {
  /**
   * Gets the text, without any byte-order mark.
   */
  readonly text: string;

  /**
   * Gets the encoding the bytes were read in.
   */
  readonly encoding: TextEncoding;

  /**
   * Gets whether the file began with a byte-order mark.
   */
  readonly bom: boolean;
}

/**
 * Determines whether bytes begin with a mark.
 * @param bytes The bytes.
 * @param mark The mark.
 * @returns Returns true when they do.
 */
function startsWith(bytes: Uint8Array, mark: readonly number[]): boolean {
  return mark.every((byte: number, index: number): boolean => bytes[index] === byte);
}

/**
 * Finds the encoding a byte-order mark names.
 * @param bytes The file's bytes.
 * @returns Returns the encoding and the mark's length, or null when the bytes carry no mark.
 */
function byteOrderMark(bytes: Uint8Array): { encoding: TextEncoding; length: number } | null {
  if (startsWith(bytes, UTF8_BOM)) {
    return { encoding: 'utf8', length: UTF8_BOM.length };
  }
  if (startsWith(bytes, UTF16LE_BOM)) {
    return { encoding: 'utf16le', length: UTF16LE_BOM.length };
  }
  if (startsWith(bytes, UTF16BE_BOM)) {
    return { encoding: 'utf16be', length: UTF16BE_BOM.length };
  }
  return null;
}

/**
 * Determines whether a file starts with a UTF-16 byte-order mark: text, though every other byte of it
 * may be zero, so a NUL-sniffing binary check must not take it for binary.
 * @param bytes The file's leading bytes.
 * @returns Returns true when the file is marked UTF-16.
 */
export function hasUtf16ByteOrderMark(bytes: Uint8Array): boolean {
  return startsWith(bytes, UTF16LE_BOM) || startsWith(bytes, UTF16BE_BOM);
}

/**
 * Determines whether bytes are valid UTF-8.
 * @param bytes The bytes.
 * @returns Returns true when they decode as UTF-8 without error.
 */
function isValidUtf8(bytes: Uint8Array): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

/**
 * Swaps each pair of bytes, turning UTF-16 BE into LE and back.
 * @param bytes The bytes; an odd last byte is dropped, as no UTF-16 code unit is one byte.
 * @returns Returns the swapped bytes.
 */
function swapPairs(bytes: Uint8Array): Buffer {
  const length: number = bytes.length - (bytes.length % 2);
  const swapped: Buffer = Buffer.alloc(length);
  for (let index: number = 0; index < length; index += 2) {
    swapped[index] = bytes[index + 1];
    swapped[index + 1] = bytes[index];
  }
  return swapped;
}

/**
 * Decodes bytes in a known encoding, with no byte-order mark left on them.
 * @param bytes The bytes.
 * @param encoding The encoding.
 * @returns Returns the text.
 */
function decodeAs(bytes: Uint8Array, encoding: TextEncoding): string {
  const buffer: Buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  switch (encoding) {
    case 'utf8':
      return buffer.toString('utf8');
    case 'utf16le':
      return buffer.subarray(0, buffer.length - (buffer.length % 2)).toString('utf16le');
    case 'utf16be':
      return swapPairs(buffer).toString('utf16le');
    case 'iso88591':
      return buffer.toString('latin1');
    case 'windows1252': {
      let text: string = '';
      for (const byte of buffer) {
        text += String.fromCharCode(
          byte >= 0x80 && byte <= 0x9f ? WINDOWS_1252_HIGH[byte - 0x80] : byte,
        );
      }
      return text;
    }
  }
}

/**
 * Decodes a file's bytes. A forced encoding wins; otherwise a byte-order mark names it, then — with
 * Auto-Detect Encoding — valid UTF-8 reads as UTF-8, and anything else in the fallback. A fallback
 * that is itself UTF cannot read bytes that are not UTF-8, so those read as Windows 1252, which
 * decodes every byte and writes back unchanged.
 * @param bytes The file's bytes.
 * @param options How to decode them.
 * @returns Returns the text, the encoding used and whether a byte-order mark was there.
 */
export function decodeText(bytes: Uint8Array, options: TextDecodeOptions = {}): DecodedText {
  const mark: { encoding: TextEncoding; length: number } | null = byteOrderMark(bytes);
  if (options.encoding !== undefined) {
    const skip: number = mark?.encoding === options.encoding ? mark.length : 0;
    return {
      text: decodeAs(bytes.subarray(skip), options.encoding),
      encoding: options.encoding,
      bom: skip > 0,
    };
  }
  if (mark !== null) {
    return {
      text: decodeAs(bytes.subarray(mark.length), mark.encoding),
      encoding: mark.encoding,
      bom: true,
    };
  }
  const fallback: TextEncoding = options.fallback ?? 'utf8';
  if (options.autoDetect !== false && isValidUtf8(bytes)) {
    return { text: decodeAs(bytes, 'utf8'), encoding: 'utf8', bom: false };
  }
  const encoding: TextEncoding =
    fallback === 'utf8' || fallback === 'utf16le' || fallback === 'utf16be'
      ? options.autoDetect === false
        ? fallback
        : 'windows1252'
      : fallback;
  return { text: decodeAs(bytes, encoding), encoding, bom: false };
}

/**
 * Encodes text into a single-byte encoding, refusing a character the encoding has no byte for rather
 * than writing a question mark in its place: a save must not lose text quietly.
 * @param text The text.
 * @param encoding The single-byte encoding.
 * @param byteFor Finds a character's byte, or undefined when it has none.
 * @returns Returns the bytes.
 */
function encodeSingleByte(
  text: string,
  encoding: TextEncoding,
  byteFor: (codePoint: number) => number | undefined,
): Buffer {
  const bytes: Buffer = Buffer.alloc(text.length);
  let length: number = 0;
  for (const character of text) {
    const byte: number | undefined = byteFor(character.codePointAt(0) ?? 0);
    if (byte === undefined) {
      throw new Error(
        `The text cannot be saved in ${encodingLabel(encoding)}: “${character}” has no ` +
          'character in it. Save with Encoding UTF-8 instead.',
      );
    }
    bytes[length++] = byte;
  }
  return bytes.subarray(0, length);
}

/**
 * Encodes text in an encoding, with that encoding's byte-order mark first when asked. A byte-order
 * mark is meaningless in a single-byte encoding and is never written in one.
 * @param text The text.
 * @param encoding The encoding.
 * @param bom Whether to begin with a byte-order mark.
 * @returns Returns the bytes.
 * @throws When a character has no byte in a single-byte encoding.
 */
export function encodeText(text: string, encoding: TextEncoding, bom: boolean = false): Buffer {
  switch (encoding) {
    case 'utf8':
      return Buffer.concat([Buffer.from(bom ? UTF8_BOM : []), Buffer.from(text, 'utf8')]);
    case 'utf16le':
      return Buffer.concat([Buffer.from(bom ? UTF16LE_BOM : []), Buffer.from(text, 'utf16le')]);
    case 'utf16be':
      return Buffer.concat([
        Buffer.from(bom ? UTF16BE_BOM : []),
        swapPairs(Buffer.from(text, 'utf16le')),
      ]);
    case 'iso88591':
      return encodeSingleByte(text, encoding, (codePoint: number): number | undefined =>
        codePoint <= 0xff ? codePoint : undefined,
      );
    case 'windows1252':
      return encodeSingleByte(text, encoding, (codePoint: number): number | undefined =>
        codePoint < 0x80 || (codePoint >= 0xa0 && codePoint <= 0xff)
          ? codePoint
          : WINDOWS_1252_BYTES.get(codePoint),
      );
  }
}
