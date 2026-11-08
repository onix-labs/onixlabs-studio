// A minimal TOML reader: enough for a Gradle version catalog (`gradle/libs.versions.toml`).
//
// A catalog uses a small part of TOML — `[tables]`, `key = value` with bare, quoted and dotted keys,
// basic and literal strings, inline tables and arrays (an array may run over several lines) — and that
// is all this reads. Numbers, booleans and dates are kept as their text, which a catalog never needs;
// multi-line strings and arrays of tables are not read at all. A line it cannot read is skipped rather
// than failing the whole file, because one odd entry should not hide every other library.

/**
 * A value read from a document: a string, an array, or a table of further values.
 */
export type TomlValue = string | readonly TomlValue[] | TomlTable;

/**
 * A table of values, by key. An interface rather than a `Record`, because the type refers to itself.
 */
export interface TomlTable {
  /**
   * Gets a value by key.
   */
  readonly [key: string]: TomlValue;
}

/**
 * A table while the document is still being read.
 */
type MutableTable = Record<string, TomlValue>;

/**
 * Reads values from one position in a document.
 */
class Cursor {
  /**
   * Holds the document.
   */
  private readonly source: string;

  /**
   * Holds the position.
   */
  public index: number;

  /**
   * Initializes the cursor.
   * @param source The document.
   * @param index Where to start.
   */
  public constructor(source: string, index: number) {
    this.source = source;
    this.index = index;
  }

  /**
   * Gets the character at the position, or an empty string at the end.
   * @returns Returns the character.
   */
  public peek(): string {
    return this.source[this.index] ?? '';
  }

  /**
   * Skips spaces and tabs, and with `lines` also newlines and comments, as arrays allow.
   * @param lines Whether newlines and comments are skipped too.
   */
  public skip(lines: boolean): void {
    for (;;) {
      const character: string = this.peek();
      if (character === ' ' || character === '\t' || (lines && /[\r\n]/.test(character))) {
        this.index += 1;
      } else if (lines && character === '#') {
        while (this.index < this.source.length && !/[\r\n]/.test(this.peek())) {
          this.index += 1;
        }
      } else {
        return;
      }
    }
  }

  /**
   * Reads a key: bare or quoted parts, joined by dots.
   * @returns Returns the key's parts.
   * @throws When there is no key here.
   */
  public key(): readonly string[] {
    const parts: string[] = [];
    for (;;) {
      this.skip(false);
      const character: string = this.peek();
      if (character === '"' || character === "'") {
        parts.push(this.string());
      } else {
        const match: RegExpExecArray | null = /^[A-Za-z0-9_-]+/.exec(this.source.slice(this.index));
        if (match === null) {
          throw new Error('Expected a key.');
        }
        parts.push(match[0]);
        this.index += match[0].length;
      }
      this.skip(false);
      if (this.peek() !== '.') {
        return parts;
      }
      this.index += 1;
    }
  }

  /**
   * Reads a value.
   * @returns Returns the value.
   * @throws When the value is not one this reader knows.
   */
  public value(): TomlValue {
    this.skip(false);
    const character: string = this.peek();
    if (character === '"' || character === "'") {
      return this.string();
    }
    if (character === '[') {
      return this.array();
    }
    if (character === '{') {
      return this.inlineTable();
    }
    const match: RegExpExecArray | null = /^[A-Za-z0-9_.:+-]+/.exec(this.source.slice(this.index));
    if (match === null) {
      throw new Error('Expected a value.');
    }
    this.index += match[0].length;
    return match[0];
  }

  /**
   * Reads a basic (`"…"`, with escapes) or literal (`'…'`) string on one line.
   * @returns Returns the string.
   * @throws When the string does not end on its line.
   */
  public string(): string {
    const quote: string = this.peek();
    if (this.source.startsWith(quote.repeat(3), this.index)) {
      throw new Error('Multi-line strings are not read.');
    }
    this.index += 1;
    let result: string = '';
    for (;;) {
      const character: string = this.peek();
      if (character === '' || character === '\n' || character === '\r') {
        throw new Error('A string did not end.');
      }
      this.index += 1;
      if (character === quote) {
        return result;
      }
      if (quote === '"' && character === '\\') {
        result += this.escape();
      } else {
        result += character;
      }
    }
  }

  /**
   * Reads the escape after a backslash in a basic string.
   * @returns Returns the character it stands for.
   */
  private escape(): string {
    const character: string = this.peek();
    this.index += 1;
    const simple: Readonly<Record<string, string>> = {
      b: '\b',
      t: '\t',
      n: '\n',
      f: '\f',
      r: '\r',
      '"': '"',
      '\\': '\\',
    };
    if (simple[character] !== undefined) {
      return simple[character];
    }
    const length: number = character === 'u' ? 4 : character === 'U' ? 8 : 0;
    if (length > 0) {
      const hex: string = this.source.slice(this.index, this.index + length);
      this.index += length;
      const code: number = Number.parseInt(hex, 16);
      return /^[0-9a-fA-F]+$/.test(hex) && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    }
    return character;
  }

  /**
   * Reads an array, which may run over several lines and end with a comma.
   * @returns Returns the array.
   * @throws When it does not end.
   */
  private array(): readonly TomlValue[] {
    this.index += 1;
    const values: TomlValue[] = [];
    for (;;) {
      this.skip(true);
      if (this.peek() === ']') {
        this.index += 1;
        return values;
      }
      if (this.peek() === '') {
        throw new Error('An array did not end.');
      }
      values.push(this.value());
      this.skip(true);
      if (this.peek() === ',') {
        this.index += 1;
      } else if (this.peek() !== ']') {
        throw new Error('Expected a comma in an array.');
      }
    }
  }

  /**
   * Reads an inline table, `{ key = value, … }`, whose keys may be dotted.
   * @returns Returns the table.
   * @throws When it does not end.
   */
  private inlineTable(): TomlTable {
    this.index += 1;
    const table: MutableTable = {};
    for (;;) {
      this.skip(false);
      if (this.peek() === '}') {
        this.index += 1;
        return table;
      }
      const key: readonly string[] = this.key();
      if (this.peek() !== '=') {
        throw new Error('Expected = in an inline table.');
      }
      this.index += 1;
      assign(table, key, this.value());
      this.skip(false);
      if (this.peek() === ',') {
        this.index += 1;
      } else if (this.peek() !== '}') {
        throw new Error('Expected a comma in an inline table.');
      }
    }
  }
}

/**
 * Sets a value at a dotted key, making the tables on the way. A key that is already a value is left
 * as it is: TOML forbids redefining one, and the first definition is the one kept.
 * @param table The table to set it in.
 * @param key The key's parts.
 * @param value The value.
 */
function assign(table: MutableTable, key: readonly string[], value: TomlValue): void {
  let current: MutableTable = table;
  for (const part of key.slice(0, -1)) {
    const existing: TomlValue | undefined = current[part];
    if (existing === undefined) {
      const created: MutableTable = {};
      current[part] = created;
      current = created;
    } else if (isTable(existing)) {
      current = existing;
    } else {
      return;
    }
  }
  current[key[key.length - 1]] ??= value;
}

/**
 * Determines whether a value is a table.
 * @param value The value.
 * @returns Returns true for a table.
 */
export function isTable(value: TomlValue | undefined): value is TomlTable {
  return typeof value === 'object' && !Array.isArray(value);
}

/**
 * Finds the table a `[header]` names, making it when it is new.
 * @param root The document's table.
 * @param key The header's parts.
 * @returns Returns the table, or null when the header names a value.
 */
function tableAt(root: MutableTable, key: readonly string[]): MutableTable | null {
  let current: MutableTable = root;
  for (const part of key) {
    const existing: TomlValue | undefined = current[part];
    if (existing === undefined) {
      const created: MutableTable = {};
      current[part] = created;
      current = created;
    } else if (isTable(existing)) {
      current = existing;
    } else {
      return null;
    }
  }
  return current;
}

/**
 * Reads a document.
 * @param source The document.
 * @returns Returns its table. Lines that could not be read are left out.
 */
export function parseToml(source: string): TomlTable {
  const root: MutableTable = {};
  let table: MutableTable | null = root;
  const cursor: Cursor = new Cursor(source, 0);
  while (cursor.index < source.length) {
    cursor.skip(true);
    if (cursor.index >= source.length) {
      break;
    }
    const start: number = cursor.index;
    try {
      if (cursor.peek() === '[') {
        if (source.startsWith('[[', cursor.index)) {
          // An array of tables: not used by a catalog. Everything under it is skipped.
          table = null;
        } else {
          cursor.index += 1;
          const key: readonly string[] = cursor.key();
          if (cursor.peek() !== ']') {
            throw new Error('Expected ] after a table header.');
          }
          cursor.index += 1;
          table = tableAt(root, key);
        }
      } else {
        const key: readonly string[] = cursor.key();
        if (cursor.peek() !== '=') {
          throw new Error('Expected =.');
        }
        cursor.index += 1;
        const value: TomlValue = cursor.value();
        if (table !== null) {
          assign(table, key, value);
        }
      }
    } catch {
      cursor.index = Math.max(cursor.index, start);
    }
    skipLine(cursor, source);
  }
  return root;
}

/**
 * Moves past the rest of a line, which may hold only a comment.
 * @param cursor The cursor.
 * @param source The document.
 */
function skipLine(cursor: Cursor, source: string): void {
  while (cursor.index < source.length && source[cursor.index] !== '\n') {
    cursor.index += 1;
  }
}
