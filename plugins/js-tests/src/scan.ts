// Finds the tests a JavaScript or TypeScript file declares, by reading it (#1354).
//
// ⛔ Nothing is run and nothing is imported: a small tokenizer skips comments, strings, template
// literals and regular expressions, and the calls that declare tests — `describe`, `it`, `test` and
// their modifiers, and Playwright's `test.describe` — are read with their literal names and nested by
// where their parentheses close. A name that is not a literal (a variable, a template with `${}`) is not
// a test this can name, so it is left for a run to report.

import { lineIndex } from '../../protocol/testing/source';

/**
 * Says what a declaration is.
 */
export type DeclarationKind = 'suite' | 'test';

/**
 * Describes one test or suite a file declares.
 */
export interface Declaration {
  /**
   * Gets whether it is a suite or a test.
   */
  readonly kind: DeclarationKind;

  /**
   * Gets its name, as written.
   */
  readonly name: string;

  /**
   * Gets the 1-based line its call starts on.
   */
  readonly line: number;

  /**
   * Gets whether it is a table-driven declaration (`.each`), whose cases a run names.
   */
  readonly table: boolean;

  /**
   * Gets the declarations inside it.
   */
  readonly children: readonly Declaration[];
}

/**
 * Describes one token: an identifier, a string literal (with its value when it has no substitutions),
 * or a single punctuation character.
 */
interface Token {
  readonly type: 'identifier' | 'string' | 'punctuation';
  readonly text: string;
  readonly start: number;
}

/**
 * The names that open a suite.
 */
const SUITES: ReadonlySet<string> = new Set<string>([
  'describe',
  'context',
  'suite',
  'fdescribe',
  'xdescribe',
]);

/**
 * The names that declare a test.
 */
const TESTS: ReadonlySet<string> = new Set<string>(['it', 'test', 'fit', 'xit', 'xtest']);

/**
 * The modifiers a declaration may carry and still be one: `it.skip`, `test.describe.only`, `it.each`.
 */
const MODIFIERS: ReadonlySet<string> = new Set<string>([
  'skip',
  'only',
  'todo',
  'concurrent',
  'sequential',
  'serial',
  'parallel',
  'fixme',
  'fails',
  'fail',
  'failing',
  'each',
  'describe',
  'runIf',
  'skipIf',
]);

/**
 * The identifier characters.
 */
const IDENTIFIER: RegExp = /[A-Za-z0-9_$]/;

/**
 * Reads a file's tokens.
 * @param source The file's text.
 * @returns Returns the tokens, comments and whitespace dropped.
 */
export function tokenize(source: string): readonly Token[] {
  const tokens: Token[] = [];
  let index: number = 0;
  const regexAllowed: () => boolean = (): boolean => {
    const previous: Token | undefined = tokens[tokens.length - 1];
    if (previous === undefined) {
      return true;
    }
    if (previous.type === 'string') {
      return false;
    }
    if (previous.type === 'identifier') {
      return [
        'return',
        'typeof',
        'case',
        'do',
        'else',
        'in',
        'of',
        'new',
        'delete',
        'void',
        'throw',
        'yield',
        'await',
      ].includes(previous.text);
    }
    return !')]}'.includes(previous.text);
  };
  while (index < source.length) {
    const char: string = source[index];
    const next: string = source[index + 1] ?? '';
    if (/\s/.test(char)) {
      index += 1;
    } else if (char === '/' && next === '/') {
      const end: number = source.indexOf('\n', index);
      index = end < 0 ? source.length : end;
    } else if (char === '/' && next === '*') {
      const end: number = source.indexOf('*/', index + 2);
      index = end < 0 ? source.length : end + 2;
    } else if (char === '"' || char === "'") {
      const start: number = index;
      let value: string = '';
      index += 1;
      while (index < source.length && source[index] !== char && source[index] !== '\n') {
        if (source[index] === '\\') {
          value += unescape(source[index + 1] ?? '');
          index += 2;
        } else {
          value += source[index];
          index += 1;
        }
      }
      index += 1;
      tokens.push({ type: 'string', text: value, start });
    } else if (char === '`') {
      const start: number = index;
      let value: string = '';
      let literal: boolean = true;
      index += 1;
      while (index < source.length && source[index] !== '`') {
        if (source[index] === '\\') {
          value += unescape(source[index + 1] ?? '');
          index += 2;
        } else if (source[index] === '$' && source[index + 1] === '{') {
          literal = false;
          index = skipSubstitution(source, index + 2);
        } else {
          value += source[index];
          index += 1;
        }
      }
      index += 1;
      // A template with a substitution names nothing the scan can know, so it is not a name at all.
      tokens.push(
        literal
          ? { type: 'string', text: value, start }
          : { type: 'punctuation', text: '`', start },
      );
    } else if (char === '/' && regexAllowed()) {
      index = skipRegex(source, index);
      tokens.push({ type: 'punctuation', text: '/', start: index });
    } else if (IDENTIFIER.test(char)) {
      const start: number = index;
      while (index < source.length && IDENTIFIER.test(source[index])) {
        index += 1;
      }
      tokens.push({ type: 'identifier', text: source.slice(start, index), start });
    } else {
      tokens.push({ type: 'punctuation', text: char, start: index });
      index += 1;
    }
  }
  return tokens;
}

/**
 * Decodes the character after a backslash.
 * @param char The character.
 * @returns Returns what it stands for.
 */
function unescape(char: string): string {
  switch (char) {
    case 'n':
      return '\n';
    case 't':
      return '\t';
    default:
      return char;
  }
}

/**
 * Skips a template substitution, which may itself hold strings and braces.
 * @param source The file's text.
 * @param index The index just after `${`.
 * @returns Returns the index just after its closing `}`.
 */
function skipSubstitution(source: string, index: number): number {
  let depth: number = 1;
  while (index < source.length && depth > 0) {
    const char: string = source[index];
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
    } else if (char === '"' || char === "'" || char === '`') {
      const end: number = source.indexOf(char, index + 1);
      index = end < 0 ? source.length : end;
    }
    index += 1;
  }
  return index;
}

/**
 * Skips a regular-expression literal.
 * @param source The file's text.
 * @param index The index of its opening `/`.
 * @returns Returns the index just after it and its flags.
 */
function skipRegex(source: string, index: number): number {
  let inClass: boolean = false;
  index += 1;
  while (index < source.length && source[index] !== '\n') {
    const char: string = source[index];
    if (char === '\\') {
      index += 2;
      continue;
    }
    if (char === '[') {
      inClass = true;
    } else if (char === ']') {
      inClass = false;
    } else if (char === '/' && !inClass) {
      index += 1;
      break;
    }
    index += 1;
  }
  while (index < source.length && /[a-z]/.test(source[index])) {
    index += 1;
  }
  return index;
}

/**
 * Finds the token closing the bracket a token opens.
 * @param tokens The tokens.
 * @param open The index of the opening `(`.
 * @returns Returns the index of the matching `)`, or the last token's when it never closes.
 */
function matching(tokens: readonly Token[], open: number): number {
  let depth: number = 0;
  for (let index: number = open; index < tokens.length; index += 1) {
    const text: string = tokens[index].type === 'punctuation' ? tokens[index].text : '';
    if (text === '(' || text === '[' || text === '{') {
      depth += 1;
    } else if (text === ')' || text === ']' || text === '}') {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return tokens.length - 1;
}

/**
 * Describes a declaration found, with the range of tokens its call spans.
 */
interface Found {
  readonly kind: DeclarationKind;
  readonly name: string;
  readonly start: number;
  readonly table: boolean;
  readonly from: number;
  readonly to: number;
}

/**
 * Finds the tests and suites a file declares, nested as written.
 * @param source The file's text.
 * @returns Returns the top-level declarations.
 */
export function scanDeclarations(source: string): readonly Declaration[] {
  const tokens: readonly Token[] = tokenize(source);
  const found: Found[] = [];
  for (let index: number = 0; index < tokens.length; index += 1) {
    const token: Token = tokens[index];
    if (token.type !== 'identifier' || (!SUITES.has(token.text) && !TESTS.has(token.text))) {
      continue;
    }
    const previous: Token | undefined = tokens[index - 1];
    if (previous?.type === 'punctuation' && previous.text === '.') {
      continue;
    }
    let kind: DeclarationKind = SUITES.has(token.text) ? 'suite' : 'test';
    let table: boolean = false;
    let cursor: number = index + 1;
    let valid: boolean = true;
    while (valid && tokens[cursor]?.text === '.' && tokens[cursor + 1]?.type === 'identifier') {
      const modifier: string = tokens[cursor + 1].text;
      valid = MODIFIERS.has(modifier);
      kind = modifier === 'describe' ? 'suite' : kind;
      table = table || modifier === 'each';
      cursor += 2;
      // `.each(table)`, `.skipIf(cond)` and `.runIf(cond)` take an argument list before the name's.
      if (
        ['each', 'skipIf', 'runIf'].includes(modifier) &&
        tokens[cursor]?.text === '(' &&
        tokens[matching(tokens, cursor) + 1]?.text === '('
      ) {
        cursor = matching(tokens, cursor) + 1;
      } else if (
        modifier === 'each' &&
        (tokens[cursor]?.type === 'string' || tokens[cursor]?.text === '`')
      ) {
        // A tagged-template table: it.each`a | b`('name').
        cursor += 1;
      }
    }
    if (!valid) {
      continue;
    }
    if (tokens[cursor]?.text !== '(' || tokens[cursor + 1]?.type !== 'string') {
      continue;
    }
    found.push({
      kind,
      name: tokens[cursor + 1].text,
      start: token.start,
      table,
      from: cursor,
      to: matching(tokens, cursor),
    });
  }
  return nest(found, source);
}

/**
 * Nests the declarations found by the ranges of their calls.
 * @param found The declarations, in source order.
 * @param source The file's text, for line numbers.
 * @returns Returns the top-level declarations.
 */
function nest(found: readonly Found[], source: string): readonly Declaration[] {
  const line: (offset: number) => number = lineIndex(source);
  interface Building {
    readonly found: Found;
    readonly children: Declaration[];
  }
  const roots: Declaration[] = [];
  const stack: Building[] = [];
  const close: () => void = (): void => {
    const done: Building | undefined = stack.pop();
    if (done === undefined) {
      return;
    }
    const declaration: Declaration = {
      kind: done.found.kind,
      name: done.found.name,
      line: line(done.found.start),
      table: done.found.table,
      children: done.children,
    };
    (stack.length === 0 ? roots : stack[stack.length - 1].children).push(declaration);
  };
  for (const item of found) {
    while (stack.length > 0 && item.from > stack[stack.length - 1].found.to) {
      close();
    }
    // A test inside a test, such as Playwright's steps, is not a test of its own.
    if (stack.length > 0 && stack[stack.length - 1].found.kind === 'test') {
      continue;
    }
    stack.push({ found: item, children: [] });
  }
  while (stack.length > 0) {
    close();
  }
  return roots;
}
