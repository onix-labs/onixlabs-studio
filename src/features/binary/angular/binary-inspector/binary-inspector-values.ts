/**
 * Describes one row of the data inspector: a type label and the bytes at the cursor decoded as that
 * type, or an em dash when too few bytes are available (near the end of the file).
 */
export interface InspectorRow {
  /**
   * Gets the type label (for example, "Integer").
   */
  readonly label: string;

  /**
   * Gets the decoded value, or `—` when there are too few bytes to decode this type.
   */
  readonly value: string;
}

/**
 * Holds the placeholder shown when there are too few loaded bytes to decode a type.
 */
const UNAVAILABLE: string = '—';

/**
 * Holds the maximum number of characters shown for the string interpretation.
 */
const MAX_STRING_LENGTH: number = 16;

/**
 * Decodes the bytes at the cursor into the inspector's fixed set of interpretations. Reads only the
 * loaded, contiguous prefix of the supplied bytes, so a type needing more bytes than are loaded (near
 * the end of the file, or before a block arrives) renders as unavailable rather than misreading.
 * @param bytes The bytes starting at the cursor; a null entry marks an unloaded or past-end byte.
 * @param littleEndian Whether multi-byte integers and floats are little-endian.
 * @param signed Whether the integer interpretations are signed.
 * @returns Returns the inspector rows in display order.
 */
export function inspectBytes(
  bytes: readonly (number | null)[],
  littleEndian: boolean,
  signed: boolean,
): InspectorRow[] {
  let loaded: number = 0;
  while (loaded < bytes.length && bytes[loaded] !== null) {
    loaded += 1;
  }

  const view: DataView = new DataView(new ArrayBuffer(8));
  for (let index: number = 0; index < loaded && index < 8; index += 1) {
    view.setUint8(index, bytes[index]!);
  }

  const decode: (width: number, read: () => string) => string = (
    width: number,
    read: () => string,
  ): string => (loaded >= width ? read() : UNAVAILABLE);

  return [
    {
      label: 'Byte',
      value: decode(1, (): string => String(signed ? view.getInt8(0) : view.getUint8(0))),
    },
    {
      label: 'Word',
      value: decode(2, (): string =>
        String(signed ? view.getInt16(0, littleEndian) : view.getUint16(0, littleEndian)),
      ),
    },
    {
      label: 'Integer',
      value: decode(4, (): string =>
        String(signed ? view.getInt32(0, littleEndian) : view.getUint32(0, littleEndian)),
      ),
    },
    {
      label: 'Long',
      value: decode(8, (): string =>
        String(signed ? view.getBigInt64(0, littleEndian) : view.getBigUint64(0, littleEndian)),
      ),
    },
    {
      label: 'Float',
      value: decode(4, (): string => formatFloat(view.getFloat32(0, littleEndian))),
    },
    {
      label: 'Double',
      value: decode(8, (): string => formatFloat(view.getFloat64(0, littleEndian))),
    },
    {
      label: 'Character',
      value: loaded >= 1 ? characterOf(bytes[0]!) : UNAVAILABLE,
    },
    {
      label: 'String',
      value: loaded >= 1 ? stringOf(bytes) : UNAVAILABLE,
    },
  ];
}

/**
 * Formats a floating-point value, keeping non-finite values readable.
 * @param value The value to format.
 * @returns Returns the formatted value.
 */
function formatFloat(value: number): string {
  if (Number.isNaN(value)) {
    return 'NaN';
  }
  if (!Number.isFinite(value)) {
    return value > 0 ? '∞' : '-∞';
  }
  return String(value);
}

/**
 * Formats a single byte as its printable ASCII character, or its hex code for control and non-ASCII
 * bytes.
 * @param byte The byte value.
 * @returns Returns the character, or a `0x`-prefixed hex code.
 */
function characterOf(byte: number): string {
  return byte >= 0x20 && byte <= 0x7e
    ? String.fromCharCode(byte)
    : `0x${byte.toString(16).padStart(2, '0').toUpperCase()}`;
}

/**
 * Reads the printable ASCII run starting at the cursor, up to {@link MAX_STRING_LENGTH} characters,
 * stopping at the first non-printable or unloaded byte.
 * @param bytes The bytes starting at the cursor.
 * @returns Returns the printable run, or `—` when the first byte is not printable.
 */
function stringOf(bytes: readonly (number | null)[]): string {
  let text: string = '';
  for (let index: number = 0; index < bytes.length && index < MAX_STRING_LENGTH; index += 1) {
    const byte: number | null = bytes[index];
    if (byte === null || byte < 0x20 || byte > 0x7e) {
      break;
    }
    text += String.fromCharCode(byte);
  }
  return text.length > 0 ? text : UNAVAILABLE;
}
