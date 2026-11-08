// A minimal TOML reader: enough of TOML 1.0 to read `Cargo.toml`, `Cargo.lock`, `.cargo/config.toml`
// and `credentials.toml`. The plugin takes no dependencies, so it carries its own.
//
// It reads every construct those files use — tables, arrays of tables, dotted and quoted keys, inline
// tables, arrays across lines, all four string forms, numbers and booleans — and is forgiving where
// forgiving costs nothing: a date is kept as its text, and a key defined twice is the last one written.
// It is not a validator; cargo is. What it must never do is read a file as something it does not say, so
// anything it cannot read is an error rather than a guess.

/**
 * One TOML value. Dates and times are kept as the text they were written as.
 */
export type TomlValue = string | number | boolean | readonly TomlValue[] | TomlTable;

/**
 * One TOML table: keys to values.
 */
export interface TomlTable {
  readonly [key: string]: TomlValue;
}

/**
 * A table while it is being read, before it is handed out read-only.
 */
type MutableTable = Record<string, TomlValue>;

/**
 * Says a TOML document could not be read, and on which line.
 */
export class TomlError extends Error {
  /**
   * Gets the 1-based line the reader stopped at.
   */
  public readonly line: number;

  /**
   * Initializes the error.
   * @param message What was wrong.
   * @param line The 1-based line it was on.
   */
  public constructor(message: string, line: number) {
    super(`${message} (line ${line})`);
    this.name = 'TomlError';
    this.line = line;
  }
}

/**
 * Matches a bare key: letters, digits, `_` and `-`.
 */
const BARE_KEY: RegExp = /[A-Za-z0-9_-]/;

/**
 * Matches the characters a number, boolean or date literal may be made of.
 */
const LITERAL_CHARACTER: RegExp = /[A-Za-z0-9_.:+-]/;

/**
 * Reads a TOML document.
 * @param text The document.
 * @returns Returns its root table.
 * @throws {TomlError} When the document is not TOML this reader can read.
 */
export function parseToml(text: string): TomlTable {
  return new TomlReader(text).read();
}

/**
 * Reads a value as a table.
 * @param value The value.
 * @returns Returns the table, or null when it is not one.
 */
export function tableOf(value: TomlValue | undefined): TomlTable | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as TomlTable)
    : null;
}

/**
 * Reads a value as a string.
 * @param value The value.
 * @returns Returns the string, or null when it is not one.
 */
export function stringOf(value: TomlValue | undefined): string | null {
  return typeof value === 'string' ? value : null;
}

/**
 * Reads a value as an array.
 * @param value The value.
 * @returns Returns the array, or an empty one when it is not one.
 */
export function arrayOf(value: TomlValue | undefined): readonly TomlValue[] {
  return Array.isArray(value) ? (value as readonly TomlValue[]) : [];
}

/**
 * Reads one TOML document, front to back, keeping its place as an index into the text.
 */
class TomlReader {
  /**
   * Holds the document.
   */
  private readonly text: string;

  /**
   * Holds the index of the next character to read.
   */
  private position: number = 0;

  /**
   * Holds the root table.
   */
  private readonly root: MutableTable = {};

  /**
   * Holds the table key/value lines are written into: the one the last header named.
   */
  private current: MutableTable = this.root;

  /**
   * Initializes the reader. A byte-order mark is not part of the document.
   * @param text The document.
   */
  public constructor(text: string) {
    this.text = text.startsWith('﻿') ? text.slice(1) : text;
  }

  /**
   * Reads the whole document.
   * @returns Returns its root table.
   */
  public read(): MutableTable {
    for (;;) {
      this.skipBlankLines();
      if (this.atEnd()) {
        return this.root;
      }
      if (this.peek() === '[') {
        this.readHeader();
      } else {
        this.readKeyValue(this.current);
      }
      this.expectEndOfLine();
    }
  }

  /**
   * Reads a `[table]` or `[[array of tables]]` header and makes the table it names current.
   */
  private readHeader(): void {
    const isArray: boolean = this.text.startsWith('[[', this.position);
    this.position += isArray ? 2 : 1;
    this.skipSpaces();
    const keys: readonly string[] = this.readKey();
    this.skipSpaces();
    if (!this.text.startsWith(isArray ? ']]' : ']', this.position)) {
      throw this.error('A table header is not closed');
    }
    this.position += isArray ? 2 : 1;
    const parent: MutableTable = this.descend(this.root, keys.slice(0, -1));
    const last: string = keys[keys.length - 1];
    if (isArray) {
      const existing: TomlValue | undefined = parent[last];
      const list: TomlValue[] = Array.isArray(existing) ? (existing as TomlValue[]) : [];
      if (existing !== undefined && !Array.isArray(existing)) {
        throw this.error(`'${keys.join('.')}' is already a value, not an array of tables`);
      }
      const table: MutableTable = {};
      list.push(table);
      parent[last] = list;
      this.current = table;
    } else {
      this.current = this.descend(parent, [last]);
    }
  }

  /**
   * Walks from a table through keys, creating the tables that are missing. A key naming an array of
   * tables walks into its latest table, which is how `[[package]]` followed by `[package.metadata]`
   * reads.
   * @param from The table to start at.
   * @param keys The keys.
   * @returns Returns the table the keys name.
   */
  private descend(from: MutableTable, keys: readonly string[]): MutableTable {
    let table: MutableTable = from;
    for (const key of keys) {
      const existing: TomlValue | undefined = table[key];
      if (existing === undefined) {
        const created: MutableTable = {};
        table[key] = created;
        table = created;
      } else if (Array.isArray(existing)) {
        const list: readonly TomlValue[] = existing as readonly TomlValue[];
        const latest: TomlValue | undefined = list[list.length - 1];
        if (tableOf(latest) === null) {
          throw this.error(`'${key}' is an array, not a table`);
        }
        table = latest as MutableTable;
      } else if (tableOf(existing) !== null) {
        table = existing as MutableTable;
      } else {
        throw this.error(`'${key}' is already a value, not a table`);
      }
    }
    return table;
  }

  /**
   * Reads one `key = value` into a table; a dotted key writes into the tables it names.
   * @param into The table.
   */
  private readKeyValue(into: MutableTable): void {
    const keys: readonly string[] = this.readKey();
    this.skipSpaces();
    if (this.peek() !== '=') {
      throw this.error(`'${keys.join('.')}' has no '='`);
    }
    this.position += 1;
    this.skipSpaces();
    const value: TomlValue = this.readValue();
    const table: MutableTable = this.descend(into, keys.slice(0, -1));
    table[keys[keys.length - 1]] = value;
  }

  /**
   * Reads a key: one or more bare or quoted parts joined by dots.
   * @returns Returns the parts.
   */
  private readKey(): readonly string[] {
    const keys: string[] = [];
    for (;;) {
      this.skipSpaces();
      const next: string = this.peek();
      if (next === '"') {
        keys.push(this.readBasicString());
      } else if (next === "'") {
        keys.push(this.readLiteralString());
      } else {
        const start: number = this.position;
        while (!this.atEnd() && BARE_KEY.test(this.peek())) {
          this.position += 1;
        }
        if (this.position === start) {
          throw this.error('Expected a key');
        }
        keys.push(this.text.slice(start, this.position));
      }
      this.skipSpaces();
      if (this.peek() !== '.') {
        return keys;
      }
      this.position += 1;
    }
  }

  /**
   * Reads one value of any kind.
   * @returns Returns the value.
   */
  private readValue(): TomlValue {
    const next: string = this.peek();
    if (next === '"') {
      return this.text.startsWith('"""', this.position)
        ? this.readMultilineBasicString()
        : this.readBasicString();
    }
    if (next === "'") {
      return this.text.startsWith("'''", this.position)
        ? this.readMultilineLiteralString()
        : this.readLiteralString();
    }
    if (next === '[') {
      return this.readArray();
    }
    if (next === '{') {
      return this.readInlineTable();
    }
    return this.readLiteral();
  }

  /**
   * Reads an array, which may run across lines and hold comments and a trailing comma.
   * @returns Returns the array.
   */
  private readArray(): readonly TomlValue[] {
    this.position += 1;
    const values: TomlValue[] = [];
    for (;;) {
      this.skipBlankLines();
      if (this.peek() === ']') {
        this.position += 1;
        return values;
      }
      if (this.atEnd()) {
        throw this.error('An array is not closed');
      }
      values.push(this.readValue());
      this.skipBlankLines();
      if (this.peek() === ',') {
        this.position += 1;
      } else if (this.peek() !== ']') {
        throw this.error('Expected a comma or the end of an array');
      }
    }
  }

  /**
   * Reads an inline table. TOML 1.0 keeps one on a line; a newline inside is tolerated, as TOML 1.1
   * allows, because refusing it would only stop a manifest cargo itself may accept.
   * @returns Returns the table.
   */
  private readInlineTable(): TomlTable {
    this.position += 1;
    const table: MutableTable = {};
    for (;;) {
      this.skipBlankLines();
      if (this.peek() === '}') {
        this.position += 1;
        return table;
      }
      if (this.atEnd()) {
        throw this.error('An inline table is not closed');
      }
      this.readKeyValue(table);
      this.skipBlankLines();
      if (this.peek() === ',') {
        this.position += 1;
      } else if (this.peek() !== '}') {
        throw this.error('Expected a comma or the end of an inline table');
      }
    }
  }

  /**
   * Reads a `"basic string"`, with its escapes.
   * @returns Returns the string.
   */
  private readBasicString(): string {
    this.position += 1;
    let value: string = '';
    for (;;) {
      if (this.atEnd() || this.peek() === '\n') {
        throw this.error('A string is not closed');
      }
      const character: string = this.peek();
      this.position += 1;
      if (character === '"') {
        return value;
      }
      value += character === '\\' ? this.readEscape() : character;
    }
  }

  /**
   * Reads a `"""multi-line basic string"""`: a newline straight after the opening quotes is dropped,
   * and a backslash at the end of a line joins it to the next line's first non-space character.
   * @returns Returns the string.
   */
  private readMultilineBasicString(): string {
    this.position += 3;
    this.skipOneNewline();
    let value: string = '';
    for (;;) {
      if (this.atEnd()) {
        throw this.error('A multi-line string is not closed');
      }
      if (this.text.startsWith('"""', this.position)) {
        // Up to two more quotes belong to the string: `""""` ends a string with one quote in it.
        let extra: number = 0;
        while (extra < 2 && this.text[this.position + 3 + extra] === '"') {
          extra += 1;
        }
        value += '"'.repeat(extra);
        this.position += 3 + extra;
        return value;
      }
      const character: string = this.peek();
      this.position += 1;
      if (character !== '\\') {
        value += character;
      } else if (/^[ \t]*\r?\n/.test(this.text.slice(this.position, this.position + 64))) {
        while (!this.atEnd() && /\s/.test(this.peek())) {
          this.position += 1;
        }
      } else {
        value += this.readEscape();
      }
    }
  }

  /**
   * Reads a `'literal string'`, which has no escapes.
   * @returns Returns the string.
   */
  private readLiteralString(): string {
    this.position += 1;
    const end: number = this.text.indexOf("'", this.position);
    const newline: number = this.text.indexOf('\n', this.position);
    if (end === -1 || (newline !== -1 && newline < end)) {
      throw this.error('A string is not closed');
    }
    const value: string = this.text.slice(this.position, end);
    this.position = end + 1;
    return value;
  }

  /**
   * Reads a `'''multi-line literal string'''`.
   * @returns Returns the string.
   */
  private readMultilineLiteralString(): string {
    this.position += 3;
    this.skipOneNewline();
    const end: number = this.text.indexOf("'''", this.position);
    if (end === -1) {
      throw this.error('A multi-line string is not closed');
    }
    let close: number = end;
    while (close - end < 2 && this.text[close + 3] === "'") {
      close += 1;
    }
    const value: string = this.text.slice(this.position, close);
    this.position = close + 3;
    return value;
  }

  /**
   * Reads the escape after a backslash in a basic string.
   * @returns Returns the character it stands for.
   */
  private readEscape(): string {
    const character: string = this.peek();
    this.position += 1;
    const simple: Readonly<Record<string, string>> = {
      b: '\b',
      t: '\t',
      n: '\n',
      f: '\f',
      r: '\r',
      e: '\u001b',
      '"': '"',
      '\\': '\\',
    };
    if (simple[character] !== undefined) {
      return simple[character];
    }
    if (character === 'u' || character === 'U') {
      const length: number = character === 'u' ? 4 : 8;
      const hex: string = this.text.slice(this.position, this.position + length);
      if (!new RegExp(`^[0-9A-Fa-f]{${length}}$`).test(hex)) {
        throw this.error('A unicode escape is malformed');
      }
      this.position += length;
      return String.fromCodePoint(Number.parseInt(hex, 16));
    }
    throw this.error(`'\\${character}' is not an escape`);
  }

  /**
   * Reads a bare literal: a boolean, a number, or a date or time, which is kept as its text.
   * @returns Returns the value.
   */
  private readLiteral(): TomlValue {
    const start: number = this.position;
    while (!this.atEnd() && LITERAL_CHARACTER.test(this.peek())) {
      this.position += 1;
    }
    // A date and a time may be separated by one space: `1979-05-27 07:32:00Z`.
    if (
      /^\d{4}-\d{2}-\d{2}$/.test(this.text.slice(start, this.position)) &&
      /^ \d{2}:/.test(this.text.slice(this.position, this.position + 4))
    ) {
      this.position += 1;
      while (!this.atEnd() && LITERAL_CHARACTER.test(this.peek())) {
        this.position += 1;
      }
    }
    const token: string = this.text.slice(start, this.position);
    if (token === 'true' || token === 'false') {
      return token === 'true';
    }
    const number: number | null = readNumber(token);
    if (number !== null) {
      return number;
    }
    if (/^\d{2,4}[-:]/.test(token)) {
      return token;
    }
    throw this.error(token.length === 0 ? 'Expected a value' : `'${token}' is not a value`);
  }

  /**
   * Insists the rest of the line is blank or a comment.
   */
  private expectEndOfLine(): void {
    this.skipSpaces();
    this.skipComment();
    if (this.atEnd()) {
      return;
    }
    if (!this.skipOneNewline()) {
      throw this.error('Expected the end of the line');
    }
  }

  /**
   * Skips whitespace, newlines and comments.
   */
  private skipBlankLines(): void {
    for (;;) {
      this.skipSpaces();
      this.skipComment();
      if (!this.skipOneNewline()) {
        return;
      }
    }
  }

  /**
   * Skips spaces and tabs.
   */
  private skipSpaces(): void {
    while (this.peek() === ' ' || this.peek() === '\t') {
      this.position += 1;
    }
  }

  /**
   * Skips a comment, up to but not including the newline.
   */
  private skipComment(): void {
    if (this.peek() === '#') {
      const newline: number = this.text.indexOf('\n', this.position);
      this.position = newline === -1 ? this.text.length : newline;
    }
  }

  /**
   * Skips one newline, either form.
   * @returns Returns true when there was one.
   */
  private skipOneNewline(): boolean {
    if (this.text.startsWith('\r\n', this.position)) {
      this.position += 2;
      return true;
    }
    if (this.peek() === '\n') {
      this.position += 1;
      return true;
    }
    return false;
  }

  /**
   * Gets the next character without reading it.
   * @returns Returns the character, or an empty string at the end.
   */
  private peek(): string {
    return this.text[this.position] ?? '';
  }

  /**
   * Determines whether the whole document has been read.
   * @returns Returns true at the end.
   */
  private atEnd(): boolean {
    return this.position >= this.text.length;
  }

  /**
   * Builds an error for where the reader is.
   * @param message What was wrong.
   * @returns Returns the error.
   */
  private error(message: string): TomlError {
    const line: number = this.text.slice(0, this.position).split('\n').length;
    return new TomlError(message, line);
  }
}

/**
 * Reads a TOML number: decimal with `_` separators, hex, octal or binary integers, floats with an
 * exponent, and `inf` / `nan`.
 * @param token The literal.
 * @returns Returns the number, or null when the literal is not one.
 */
function readNumber(token: string): number | null {
  const bare: string = token.replace(/_/g, '');
  if (/^[+-]?(inf|nan)$/.test(bare)) {
    const negative: boolean = bare.startsWith('-');
    return bare.endsWith('nan') ? Number.NaN : negative ? -Infinity : Infinity;
  }
  if (/^0x[0-9A-Fa-f]+$/.test(bare)) {
    return Number.parseInt(bare.slice(2), 16);
  }
  if (/^0o[0-7]+$/.test(bare)) {
    return Number.parseInt(bare.slice(2), 8);
  }
  if (/^0b[01]+$/.test(bare)) {
    return Number.parseInt(bare.slice(2), 2);
  }
  if (/^[+-]?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(bare)) {
    return Number(bare);
  }
  return null;
}
