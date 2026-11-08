// A minimal TOML reader: enough of TOML 1.0 for `pyproject.toml`, `Pipfile`, `uv.lock` and
// `poetry.lock`, without taking a dependency for it (a plugin ships nothing it does not need).
//
// It reads tables, arrays of tables, dotted and quoted keys, every string form, arrays across lines and
// inline tables. Numbers become numbers; dates and times stay as their text, since nothing here needs
// them as dates. It is a reader, not a validator: a document it cannot follow is refused as a whole
// (`parseToml` answers null) rather than half-read, so a project is never shown with half its
// dependencies.

/**
 * A TOML table, as read.
 */
export interface TomlTable {
  [key: string]: TomlValue;
}

/**
 * A TOML value, as read.
 */
export type TomlValue = string | number | boolean | TomlValue[] | TomlTable;

/**
 * Reads a TOML document.
 * @param text The document.
 * @returns Returns the root table, or null when the document is not TOML this reader can follow.
 */
export function parseToml(text: string): TomlTable | null {
  try {
    return new TomlReader(text.replace(/^\uFEFF/, '')).read();
  } catch {
    return null;
  }
}

/**
 * Reads a table out of a value, or nothing when it is not one.
 * @param value The value.
 * @returns Returns the table, or null.
 */
export function asTable(value: TomlValue | undefined): TomlTable | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : null;
}

/**
 * Reads an array out of a value, or an empty one when it is not one.
 * @param value The value.
 * @returns Returns the array.
 */
export function asArray(value: TomlValue | undefined): readonly TomlValue[] {
  return Array.isArray(value) ? value : [];
}

/**
 * Reads a string out of a value, or nothing when it is not one.
 * @param value The value.
 * @returns Returns the string, or null.
 */
export function asString(value: TomlValue | undefined): string | null {
  return typeof value === 'string' ? value : null;
}

/**
 * Walks a document character by character. Holds a cursor, so one reader reads one document.
 */
class TomlReader {
  /**
   * Holds the document.
   */
  private readonly text: string;

  /**
   * Holds the cursor.
   */
  private index: number = 0;

  /**
   * Holds the root table.
   */
  private readonly root: TomlTable = {};

  /**
   * Holds the tables written by a `[header]` or as an element of `[[header]]`, which a second header
   * of the same name may not reopen.
   */
  private readonly declared: Set<TomlTable> = new Set<TomlTable>();

  /**
   * Initializes the reader.
   * @param text The document.
   */
  public constructor(text: string) {
    this.text = text;
  }

  /**
   * Reads the whole document.
   * @returns Returns the root table.
   * @throws When the document is not TOML this reader can follow.
   */
  public read(): TomlTable {
    let current: TomlTable = this.root;
    for (;;) {
      this.skipBlank();
      if (this.index >= this.text.length) {
        return this.root;
      }
      if (this.text.startsWith('[[', this.index)) {
        this.index += 2;
        const keys: readonly string[] = this.readKey();
        this.expect(']]');
        current = this.appendTable(keys);
      } else if (this.text[this.index] === '[') {
        this.index += 1;
        const keys: readonly string[] = this.readKey();
        this.expect(']');
        current = this.openTable(keys);
      } else {
        this.readPair(current);
      }
      this.endLine();
    }
  }

  /**
   * Reads one `key = value` pair into a table.
   * @param table The table.
   * @throws When the pair is malformed or sets a key twice.
   */
  private readPair(table: TomlTable): void {
    const keys: readonly string[] = this.readKey();
    this.skipSpaces();
    this.expect('=');
    this.skipSpaces();
    const value: TomlValue = this.readValue();
    let target: TomlTable = table;
    for (const key of keys.slice(0, -1)) {
      const next: TomlValue | undefined = target[key];
      if (next === undefined) {
        const created: TomlTable = {};
        target[key] = created;
        target = created;
      } else if (asTable(next) !== null) {
        target = next as TomlTable;
      } else {
        throw new Error(`'${key}' is not a table`);
      }
    }
    const last: string = keys[keys.length - 1];
    if (Object.prototype.hasOwnProperty.call(target, last)) {
      throw new Error(`'${last}' is set twice`);
    }
    target[last] = value;
  }

  /**
   * Finds or makes the table a `[header]` names.
   * @param keys The header's keys.
   * @returns Returns the table.
   * @throws When the path runs through something that is not a table, or the table was declared.
   */
  private openTable(keys: readonly string[]): TomlTable {
    const table: TomlTable = this.walk(keys);
    if (this.declared.has(table)) {
      throw new Error('a table is declared twice');
    }
    this.declared.add(table);
    return table;
  }

  /**
   * Appends a new element to the array of tables a `[[header]]` names.
   * @param keys The header's keys.
   * @returns Returns the new table.
   * @throws When the name is already something other than an array of tables.
   */
  private appendTable(keys: readonly string[]): TomlTable {
    const parent: TomlTable = this.walk(keys.slice(0, -1));
    const last: string = keys[keys.length - 1];
    const existing: TomlValue | undefined = parent[last];
    const table: TomlTable = {};
    if (existing === undefined) {
      parent[last] = [table];
    } else if (Array.isArray(existing)) {
      existing.push(table);
    } else {
      throw new Error(`'${last}' is not an array of tables`);
    }
    this.declared.add(table);
    return table;
  }

  /**
   * Walks from the root to the table a path names, making the ones that are missing, and stepping into
   * the last element of an array of tables on the way, as a header does.
   * @param keys The path.
   * @returns Returns the table.
   * @throws When the path runs through a value that is not a table.
   */
  private walk(keys: readonly string[]): TomlTable {
    let table: TomlTable = this.root;
    for (const key of keys) {
      const next: TomlValue | undefined = table[key];
      if (next === undefined) {
        const created: TomlTable = {};
        table[key] = created;
        table = created;
      } else if (Array.isArray(next)) {
        const last: TomlTable | null = asTable(next[next.length - 1]);
        if (last === null) {
          throw new Error(`'${key}' is not an array of tables`);
        }
        table = last;
      } else if (asTable(next) !== null) {
        table = next as TomlTable;
      } else {
        throw new Error(`'${key}' is not a table`);
      }
    }
    return table;
  }

  /**
   * Reads a key, dotted or not, each part bare or quoted.
   * @returns Returns its parts.
   * @throws When there is no key here.
   */
  private readKey(): readonly string[] {
    const keys: string[] = [];
    for (;;) {
      this.skipSpaces();
      const character: string | undefined = this.text[this.index];
      if (character === '"') {
        keys.push(this.readBasicString());
      } else if (character === "'") {
        keys.push(this.readLiteralString());
      } else {
        const match: RegExpExecArray | null = /^[A-Za-z0-9_-]+/.exec(this.text.slice(this.index));
        if (match === null) {
          throw new Error('a key was expected');
        }
        keys.push(match[0]);
        this.index += match[0].length;
      }
      this.skipSpaces();
      if (this.text[this.index] !== '.') {
        return keys;
      }
      this.index += 1;
    }
  }

  /**
   * Reads one value.
   * @returns Returns the value.
   * @throws When there is no value here this reader knows.
   */
  private readValue(): TomlValue {
    if (this.text.startsWith('"""', this.index)) {
      return this.readMultilineBasicString();
    }
    if (this.text.startsWith("'''", this.index)) {
      return this.readMultilineLiteralString();
    }
    const character: string | undefined = this.text[this.index];
    if (character === '"') {
      return this.readBasicString();
    }
    if (character === "'") {
      return this.readLiteralString();
    }
    if (character === '[') {
      return this.readArray();
    }
    if (character === '{') {
      return this.readInlineTable();
    }
    return this.readScalar();
  }

  /**
   * Reads a boolean, a number, or a date or time (kept as its text).
   * @returns Returns the value.
   * @throws When the token is empty.
   */
  private readScalar(): TomlValue {
    const match: RegExpExecArray | null = /^[^\s,\]}#]+/.exec(this.text.slice(this.index));
    if (match === null) {
      throw new Error('a value was expected');
    }
    let token: string = match[0];
    this.index += token.length;
    // A date and a time may be separated by one space: `1979-05-27 07:32:00`.
    const time: RegExpExecArray | null = /^\d{4}-\d{2}-\d{2}$/.test(token)
      ? /^ \d{2}:\d{2}[^\s,\]}#]*/.exec(this.text.slice(this.index))
      : null;
    if (time !== null) {
      token += time[0];
      this.index += time[0].length;
    }
    if (token === 'true' || token === 'false') {
      return token === 'true';
    }
    const digits: string = token.replaceAll('_', '');
    if (/^[+-]?(\d+(\.\d+)?([eE][+-]?\d+)?|0x[0-9a-fA-F]+|0o[0-7]+|0b[01]+)$/.test(digits)) {
      return Number(digits.replace(/^\+/, ''));
    }
    if (/^[+-]?(inf|nan)$/.test(token)) {
      return token.includes('nan') ? Number.NaN : token.startsWith('-') ? -Infinity : Infinity;
    }
    if (/^\d/.test(token)) {
      return token;
    }
    throw new Error(`'${token}' is not a value`);
  }

  /**
   * Reads an array, which may run across lines and hold comments and a trailing comma.
   * @returns Returns the array.
   * @throws When it is not closed.
   */
  private readArray(): TomlValue[] {
    this.index += 1;
    const values: TomlValue[] = [];
    for (;;) {
      this.skipBlank();
      if (this.text[this.index] === ']') {
        this.index += 1;
        return values;
      }
      values.push(this.readValue());
      this.skipBlank();
      if (this.text[this.index] === ',') {
        this.index += 1;
      } else if (this.text[this.index] !== ']') {
        throw new Error('an array is not closed');
      }
    }
  }

  /**
   * Reads an inline table, `{ key = value, … }`.
   * @returns Returns the table.
   * @throws When it is not closed.
   */
  private readInlineTable(): TomlTable {
    this.index += 1;
    const table: TomlTable = {};
    this.skipSpaces();
    if (this.text[this.index] === '}') {
      this.index += 1;
      return table;
    }
    for (;;) {
      this.readPair(table);
      this.skipSpaces();
      const character: string | undefined = this.text[this.index];
      this.index += 1;
      if (character === '}') {
        return table;
      }
      if (character !== ',') {
        throw new Error('an inline table is not closed');
      }
    }
  }

  /**
   * Reads a `"basic"` string, with its escapes.
   * @returns Returns the string.
   * @throws When it is not closed on its line.
   */
  private readBasicString(): string {
    this.index += 1;
    let result: string = '';
    for (;;) {
      const character: string | undefined = this.text[this.index];
      if (character === undefined || character === '\n') {
        throw new Error('a string is not closed');
      }
      this.index += 1;
      if (character === '"') {
        return result;
      }
      result += character === '\\' ? this.readEscape() : character;
    }
  }

  /**
   * Reads a `"""multi-line basic"""` string: a newline straight after the opening is dropped, and a
   * backslash at the end of a line joins it to the next.
   * @returns Returns the string.
   * @throws When it is not closed.
   */
  private readMultilineBasicString(): string {
    this.index += 3;
    this.skipOpeningNewline();
    let result: string = '';
    for (;;) {
      if (this.index >= this.text.length) {
        throw new Error('a string is not closed');
      }
      if (this.text.startsWith('"""', this.index)) {
        // Up to two quotes may sit right before the closing three.
        let quotes: number = 3;
        while (quotes < 5 && this.text[this.index + quotes] === '"') {
          quotes += 1;
        }
        result += '"'.repeat(quotes - 3);
        this.index += quotes;
        return result;
      }
      const character: string = this.text[this.index];
      this.index += 1;
      if (character !== '\\') {
        result += character;
      } else if (/^[ \t]*\r?\n/.test(this.text.slice(this.index))) {
        while (/\s/.test(this.text[this.index] ?? '')) {
          this.index += 1;
        }
      } else {
        result += this.readEscape();
      }
    }
  }

  /**
   * Reads a `'literal'` string: no escapes.
   * @returns Returns the string.
   * @throws When it is not closed on its line.
   */
  private readLiteralString(): string {
    const end: number = this.text.indexOf("'", this.index + 1);
    const newline: number = this.text.indexOf('\n', this.index + 1);
    if (end === -1 || (newline !== -1 && newline < end)) {
      throw new Error('a string is not closed');
    }
    const result: string = this.text.slice(this.index + 1, end);
    this.index = end + 1;
    return result;
  }

  /**
   * Reads a `'''multi-line literal'''` string.
   * @returns Returns the string.
   * @throws When it is not closed.
   */
  private readMultilineLiteralString(): string {
    this.index += 3;
    this.skipOpeningNewline();
    const end: number = this.text.indexOf("'''", this.index);
    if (end === -1) {
      throw new Error('a string is not closed');
    }
    let close: number = end;
    while (close + 3 < this.text.length && close - end < 2 && this.text[close + 3] === "'") {
      close += 1;
    }
    const result: string = this.text.slice(this.index, close);
    this.index = close + 3;
    return result;
  }

  /**
   * Reads the escape after a backslash in a basic string.
   * @returns Returns the character it stands for.
   * @throws When it is not an escape TOML has.
   */
  private readEscape(): string {
    const character: string | undefined = this.text[this.index];
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
    if (character !== undefined && simple[character] !== undefined) {
      return simple[character];
    }
    if (character === 'u' || character === 'U') {
      const length: number = character === 'u' ? 4 : 8;
      const hex: string = this.text.slice(this.index, this.index + length);
      if (!new RegExp(`^[0-9a-fA-F]{${length}}$`).test(hex)) {
        throw new Error('a unicode escape is malformed');
      }
      this.index += length;
      return String.fromCodePoint(Number.parseInt(hex, 16));
    }
    throw new Error('an escape is malformed');
  }

  /**
   * Drops the newline straight after a multi-line string's opening quotes.
   */
  private skipOpeningNewline(): void {
    if (this.text.startsWith('\r\n', this.index)) {
      this.index += 2;
    } else if (this.text[this.index] === '\n') {
      this.index += 1;
    }
  }

  /**
   * Skips spaces and tabs.
   */
  private skipSpaces(): void {
    while (this.text[this.index] === ' ' || this.text[this.index] === '\t') {
      this.index += 1;
    }
  }

  /**
   * Skips whitespace, newlines and comments.
   */
  private skipBlank(): void {
    for (;;) {
      const character: string | undefined = this.text[this.index];
      if (character === ' ' || character === '\t' || character === '\r' || character === '\n') {
        this.index += 1;
      } else if (character === '#') {
        this.skipComment();
      } else {
        return;
      }
    }
  }

  /**
   * Skips a comment, up to its line's end.
   */
  private skipComment(): void {
    while (this.index < this.text.length && this.text[this.index] !== '\n') {
      this.index += 1;
    }
  }

  /**
   * Ends a line: nothing but spaces and a comment may follow a header or a pair.
   * @throws When something else does.
   */
  private endLine(): void {
    this.skipSpaces();
    if (this.text[this.index] === '#') {
      this.skipComment();
    }
    if (this.text[this.index] === '\r') {
      this.index += 1;
    }
    if (this.index < this.text.length && this.text[this.index] !== '\n') {
      throw new Error('a line has something after its value');
    }
  }

  /**
   * Steps over a fixed piece of text.
   * @param token The text.
   * @throws When it is not here.
   */
  private expect(token: string): void {
    this.skipSpaces();
    if (!this.text.startsWith(token, this.index)) {
      throw new Error(`'${token}' was expected`);
    }
    this.index += token.length;
  }
}
