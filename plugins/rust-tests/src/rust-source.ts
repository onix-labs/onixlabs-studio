// Finds the tests one Rust source file declares, and the modules it pulls in from other files (#1356).
//
// Not a Rust parser: comments and string literals are blanked out, so a brace or a `#[test]` inside one
// cannot be mistaken for code, and what is left is read for the few shapes that matter — attributes,
// `mod name { … }`, `mod name;` and `fn name`. ⛔ Nothing is compiled or run.

/**
 * Describes a test function found in a file.
 */
export interface RustTestFunction {
  /**
   * Gets the inline modules it is nested in, outermost first, within the file's own module.
   */
  readonly modules: readonly string[];

  /**
   * Gets the function's name.
   */
  readonly name: string;

  /**
   * Gets its 1-based line.
   */
  readonly line: number;

  /**
   * Gets whether it is marked `#[ignore]`.
   */
  readonly ignored: boolean;
}

/**
 * Describes a `mod name;` declaration: a module whose body is another file.
 */
export interface RustFileModule {
  /**
   * Gets the inline modules the declaration is nested in, outermost first.
   */
  readonly modules: readonly string[];

  /**
   * Gets the module's name.
   */
  readonly name: string;

  /**
   * Gets the file a `#[path = "…"]` attribute names, when one does.
   */
  readonly path?: string;
}

/**
 * Describes what one file declares.
 */
export interface RustFileScan {
  /**
   * Gets its test functions.
   */
  readonly tests: readonly RustTestFunction[];

  /**
   * Gets the modules it declares in other files.
   */
  readonly fileModules: readonly RustFileModule[];
}

/**
 * Blanks out comments, string literals and character literals, keeping every newline and offset, so
 * what is left can be scanned for code.
 * @param text The source.
 * @returns Returns the source with those spans replaced by spaces.
 */
export function blankLiterals(text: string): string {
  const out: string[] = [...text];
  const blank: (from: number, to: number) => void = (from: number, to: number): void => {
    for (let index: number = from; index < to && index < out.length; index += 1) {
      if (out[index] !== '\n') {
        out[index] = ' ';
      }
    }
  };
  let index: number = 0;
  while (index < text.length) {
    const char: string = text[index];
    const next: string = text[index + 1] ?? '';
    if (char === '/' && next === '/') {
      const end: number = text.indexOf('\n', index);
      const stop: number = end < 0 ? text.length : end;
      blank(index, stop);
      index = stop;
    } else if (char === '/' && next === '*') {
      // Block comments nest in Rust.
      let depth: number = 1;
      let cursor: number = index + 2;
      while (cursor < text.length && depth > 0) {
        if (text[cursor] === '/' && text[cursor + 1] === '*') {
          depth += 1;
          cursor += 2;
        } else if (text[cursor] === '*' && text[cursor + 1] === '/') {
          depth -= 1;
          cursor += 2;
        } else {
          cursor += 1;
        }
      }
      blank(index, cursor);
      index = cursor;
    } else if (
      char === 'r' &&
      /^r(#*)"/.test(text.slice(index, index + 260)) &&
      !/\w/.test(text[index - 1] ?? '')
    ) {
      const hashes: string = /^r(#*)"/.exec(text.slice(index))?.[1] ?? '';
      const close: string = `"${hashes}`;
      const end: number = text.indexOf(close, index + 2 + hashes.length);
      const stop: number = end < 0 ? text.length : end + close.length;
      blank(index, stop);
      index = stop;
    } else if (char === '"') {
      let cursor: number = index + 1;
      while (cursor < text.length && text[cursor] !== '"') {
        cursor += text[cursor] === '\\' ? 2 : 1;
      }
      blank(index, cursor + 1);
      index = cursor + 1;
    } else if (char === "'") {
      // A character literal, not a lifetime: `'x'`, `'\n'`, `'\u{1F600}'`.
      const literal: RegExpExecArray | null =
        /^'(?:\\(?:u\{[0-9a-fA-F]+\}|x[0-9a-fA-F]{2}|.)|[^\\'\n])'/.exec(
          text.slice(index, index + 16),
        );
      if (literal !== null) {
        blank(index, index + literal[0].length);
        index += literal[0].length;
      } else {
        index += 1;
      }
    } else {
      index += 1;
    }
  }
  return out.join('');
}

/**
 * Determines whether an attribute's text marks a test: `test`, or a path ending in `test` such as
 * `tokio::test` or `async_std::test(flavor = "…")`. `cfg(test)` does not.
 * @param attribute The attribute's text, without `#[` and `]`.
 * @returns Returns true when it marks a test.
 */
export function isTestAttribute(attribute: string): boolean {
  return /^(?:[A-Za-z_]\w*\s*::\s*)*test\s*(?:\([\s\S]*\))?$/.test(attribute.trim());
}

/**
 * Scans one file for its tests and its file modules.
 * @param text The file's text.
 * @returns Returns what it declares.
 */
export function scanRustFile(text: string): RustFileScan {
  const code: string = blankLiterals(text);
  const starts: number[] = [0];
  for (let index: number = 0; index < code.length; index += 1) {
    if (code.charCodeAt(index) === 10) {
      starts.push(index + 1);
    }
  }
  const lineOf: (offset: number) => number = (offset: number): number => {
    let low: number = 0;
    let high: number = starts.length - 1;
    while (low < high) {
      const middle: number = (low + high + 1) >> 1;
      if (starts[middle] <= offset) {
        low = middle;
      } else {
        high = middle - 1;
      }
    }
    return low + 1;
  };
  const tests: RustTestFunction[] = [];
  const fileModules: RustFileModule[] = [];
  const modules: { readonly name: string; readonly depth: number }[] = [];
  let depth: number = 0;
  let pending: string[] = [];
  const token: RegExp = /#\s*\[|\bmod\s+([A-Za-z_]\w*)\s*([{;])|\bfn\s+([A-Za-z_]\w*)|[{};]/g;
  let match: RegExpExecArray | null = token.exec(code);
  while (match !== null) {
    const lexeme: string = match[0];
    if (lexeme.startsWith('#')) {
      // An outer attribute: read to its matching bracket.
      let cursor: number = token.lastIndex;
      let brackets: number = 1;
      while (cursor < code.length && brackets > 0) {
        if (code[cursor] === '[') {
          brackets += 1;
        } else if (code[cursor] === ']') {
          brackets -= 1;
        }
        cursor += 1;
      }
      // Read from the source rather than the blanked code: a `#[path = "…"]` value is a string literal.
      pending.push(
        text
          .slice(match.index, cursor)
          .replace(/^#\s*\[/, '')
          .replace(/\]$/, ''),
      );
      token.lastIndex = cursor;
    } else if (match[1] !== undefined) {
      const names: readonly string[] = modules.map((module) => module.name);
      if (match[2] === '{') {
        depth += 1;
        modules.push({ name: match[1], depth });
      } else {
        const pathAttribute: string | undefined = pending
          .map((attribute: string): RegExpExecArray | null =>
            /^path\s*=\s*"([^"]+)"$/.exec(attribute.trim()),
          )
          .find((found: RegExpExecArray | null): found is RegExpExecArray => found !== null)?.[1];
        fileModules.push({
          modules: names,
          name: match[1],
          ...(pathAttribute === undefined ? {} : { path: pathAttribute }),
        });
      }
      pending = [];
    } else if (match[3] !== undefined) {
      if (pending.some(isTestAttribute)) {
        tests.push({
          modules: modules.map((module) => module.name),
          name: match[3],
          line: lineOf(match.index),
          ignored: pending.some((attribute: string): boolean => /^ignore\b/.test(attribute.trim())),
        });
      }
      pending = [];
    } else if (lexeme === '{') {
      depth += 1;
      pending = [];
    } else if (lexeme === '}') {
      if (modules.length > 0 && modules[modules.length - 1].depth === depth) {
        modules.pop();
      }
      depth -= 1;
      pending = [];
    } else {
      pending = [];
    }
    match = token.exec(code);
  }
  return { tests, fileModules };
}
