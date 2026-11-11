import { DatabaseValue } from '../../protocol/database/protocol';
import { bigintValue, bytesValue, text } from '../../protocol/database/engine';

/**
 * The parts of a column's metadata the engine reads: `tedious`'s type, and the column's size.
 */
export interface SqlServerColumnType {
  /**
   * Gets `tedious`'s name for the type: `Int`, `NVarChar`, or a nullable form such as `IntN`.
   */
  readonly name: string;

  /**
   * Gets the column's byte length, which tells a nullable integer, float, money or date type apart.
   */
  readonly dataLength?: number;
}

/**
 * The sizes of `tedious`'s nullable types, by byte length: the one `IntN` stands for every integer.
 */
const SIZED_TYPES: Readonly<Record<string, Readonly<Record<number, string>>>> = {
  IntN: { 1: 'tinyint', 2: 'smallint', 4: 'int', 8: 'bigint' },
  FloatN: { 4: 'real', 8: 'float' },
  MoneyN: { 4: 'smallmoney', 8: 'money' },
  DateTimeN: { 4: 'smalldatetime', 8: 'datetime' },
};

/**
 * The plain names of `tedious`'s other nullable types.
 */
const NULLABLE_TYPES: Readonly<Record<string, string>> = {
  BitN: 'bit',
  DecimalN: 'decimal',
  NumericN: 'numeric',
};

/**
 * Names a column's type as SQL Server does (`int`, `nvarchar`, `datetime2`), from the type `tedious`
 * reports: its nullable types are told apart by their byte length.
 * @param type The column's type and size.
 * @returns Returns the name.
 */
export function sqlTypeName(type: SqlServerColumnType): string {
  const sized: Readonly<Record<number, string>> | undefined = SIZED_TYPES[type.name];
  if (sized !== undefined) {
    return sized[type.dataLength ?? 0] ?? sized[8] ?? type.name.toLowerCase();
  }
  return NULLABLE_TYPES[type.name] ?? type.name.toLowerCase();
}

/**
 * Converts one cell `tedious` read into the typed value the grid shows. A `bigint` comes as a string of
 * digits and stays exact; binary as a buffer, shown by size and a preview; a date or time as the
 * `Date` `tedious` makes (in UTC), written as ISO text. ⚠️ `tedious` reads `decimal`, `numeric` and
 * `money` into JavaScript numbers, so a value past fifteen significant digits is rounded, and
 * `datetime2`'s sub-millisecond digits are lost to `Date`.
 * @param value The cell.
 * @param typeName The column's type, as {@link sqlTypeName} names it.
 * @returns Returns the typed value.
 */
export function cellValue(value: unknown, typeName: string): DatabaseValue {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeName === 'bigint' && (typeof value === 'string' || typeof value === 'number')) {
    try {
      return bigintValue(BigInt(value));
    } catch {
      return String(value);
    }
  }
  // Asked of the view rather than by `instanceof`, which a buffer from another realm would fail.
  if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
    return bytesValue(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
  }
  if (value instanceof Date) {
    return { type: 'temporal', value: temporalText(value, typeName) };
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') {
    return value;
  }
  return text(value);
}

/**
 * Writes a date or time as the type asks: a `date` as its day, a `time` as its time of day, and every
 * other as a full ISO timestamp.
 * @param value The value.
 * @param typeName The column's type.
 * @returns Returns the text.
 */
function temporalText(value: Date, typeName: string): string {
  if (Number.isNaN(value.getTime())) {
    return 'Invalid date';
  }
  const iso: string = value.toISOString();
  if (typeName === 'date') {
    return iso.slice(0, 10);
  }
  if (typeName === 'time') {
    return iso.slice(11, 23);
  }
  return iso;
}

/**
 * Writes a column's declared type as a script would: a length for character and binary types (`max`
 * for unbounded, and half the bytes for the national types), precision and scale for decimals, and
 * the fractional digits for the precise date and time types.
 * @param type The type's name.
 * @param maxLength The column's length in bytes; -1 for `max`.
 * @param precision Its precision.
 * @param scale Its scale.
 * @returns Returns the declaration.
 */
export function declaredType(
  type: string,
  maxLength: number,
  precision: number,
  scale: number,
): string {
  switch (type) {
    case 'char':
    case 'varchar':
    case 'binary':
    case 'varbinary':
      return `${type}(${maxLength === -1 ? 'max' : maxLength})`;
    case 'nchar':
    case 'nvarchar':
      return `${type}(${maxLength === -1 ? 'max' : maxLength / 2})`;
    case 'decimal':
    case 'numeric':
      return `${type}(${precision}, ${scale})`;
    case 'datetime2':
    case 'datetimeoffset':
    case 'time':
      return `${type}(${scale})`;
    default:
      return type;
  }
}

/**
 * Quotes an identifier for T-SQL with brackets, doubling any closing bracket it contains.
 * @param name The identifier.
 * @returns Returns the quoted identifier.
 */
export function bracket(name: string): string {
  return `[${name.replaceAll(']', ']]')}]`;
}

/**
 * Writes text as a T-SQL Unicode string literal, doubling any quote it contains.
 * @param value The text.
 * @returns Returns the literal.
 */
export function nstring(value: string): string {
  return `N'${value.replaceAll("'", "''")}'`;
}
