// Finds the test methods a C# source file declares, by reading it (#1353). ⛔ Nothing is compiled or run:
// the scan blanks comments and string literals, then walks namespaces, type declarations, braces and
// attribute lists to find methods carrying a test attribute.
//
// Deliberately not a C# parser. It reads what test code looks like in practice — attributes on methods
// in classes, in block or file-scoped namespaces, nested types — and a test it misreads is found anyway
// when it runs, because results the scan did not name still join the tree.

/**
 * Describes one test method the scan found.
 */
export interface ScannedTest {
  /**
   * Gets the fully qualified name of its class, as the test platform names it: namespaces joined by
   * `.`, nested types by `+`.
   */
  readonly className: string;

  /**
   * Gets the 1-based line the class is declared on.
   */
  readonly classLine: number;

  /**
   * Gets the method's name.
   */
  readonly method: string;

  /**
   * Gets the 1-based line the method is declared on.
   */
  readonly line: number;

  /**
   * Gets the test attributes it carries, without namespace or `Attribute` suffix.
   */
  readonly attributes: readonly string[];
}

/**
 * Blanks a C# source's comments and string and character literals with spaces, keeping every newline
 * so offsets still map to the same lines.
 * @param source The source.
 * @returns Returns the source with only code left.
 */
export function blankCommentsAndStrings(source: string): string {
  const out: string[] = [];
  const blank: (text: string) => string = (text: string): string => text.replace(/[^\n]/g, ' ');
  let index: number = 0;
  while (index < source.length) {
    const char: string = source[index];
    const next: string = source[index + 1] ?? '';
    if (char === '/' && next === '/') {
      const end: number = source.indexOf('\n', index);
      const stop: number = end < 0 ? source.length : end;
      out.push(blank(source.slice(index, stop)));
      index = stop;
      continue;
    }
    if (char === '/' && next === '*') {
      const end: number = source.indexOf('*/', index + 2);
      const stop: number = end < 0 ? source.length : end + 2;
      out.push(blank(source.slice(index, stop)));
      index = stop;
      continue;
    }
    const literal: number = stringLiteralEnd(source, index);
    if (literal > index) {
      out.push(blank(source.slice(index, literal)));
      index = literal;
      continue;
    }
    out.push(char);
    index += 1;
  }
  return out.join('');
}

/**
 * Finds where a string or character literal starting at an offset ends.
 * @param source The source.
 * @param start The offset.
 * @returns Returns the offset just past the literal, or `start` when none starts there.
 */
function stringLiteralEnd(source: string, start: number): number {
  const prefix: RegExpExecArray | null = /^[$@]{0,3}(?="|')/.exec(source.slice(start, start + 4));
  if (prefix === null) {
    return start;
  }
  const quoteAt: number = start + prefix[0].length;
  const quote: string = source[quoteAt];
  if (quote === "'") {
    if (prefix[0].length > 0) {
      return start;
    }
    for (let index: number = quoteAt + 1; index < source.length; index += 1) {
      if (source[index] === '\\') {
        index += 1;
      } else if (source[index] === "'" || source[index] === '\n') {
        return index + 1;
      }
    }
    return source.length;
  }
  const raw: RegExpExecArray | null = /^"{3,}/.exec(source.slice(quoteAt));
  if (raw !== null) {
    const end: number = source.indexOf(raw[0], quoteAt + raw[0].length);
    return end < 0 ? source.length : end + raw[0].length;
  }
  const verbatim: boolean = prefix[0].includes('@');
  for (let index: number = quoteAt + 1; index < source.length; index += 1) {
    const char: string = source[index];
    if (verbatim) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          index += 1;
          continue;
        }
        return index + 1;
      }
    } else if (char === '\\') {
      index += 1;
    } else if (char === '"' || char === '\n') {
      return index + 1;
    }
  }
  return source.length;
}

/**
 * Reads the attribute names in one attribute list's text: `Test, Ignore("x")` names Test and Ignore.
 * @param list The text between the brackets.
 * @returns Returns the names, without a namespace, a target such as `method:`, or the `Attribute` suffix.
 */
export function attributeNames(list: string): readonly string[] {
  let flat: string = list;
  let previous: string = '';
  while (flat !== previous) {
    previous = flat;
    flat = flat.replace(/\([^()]*\)/g, '');
  }
  return flat
    .replace(/^\s*\w+\s*:(?!:)/, '')
    .split(',')
    .map((part: string): string => /^\s*([\w.]+)/.exec(part)?.[1] ?? '')
    .filter((name: string): boolean => name.length > 0)
    .map((name: string): string => name.split('.').pop() ?? name)
    .map((name: string): string =>
      name.endsWith('Attribute') && name.length > 'Attribute'.length
        ? name.slice(0, -'Attribute'.length)
        : name,
    );
}

/**
 * Describes one open scope while walking a file.
 */
interface Scope {
  readonly kind: 'namespace' | 'type' | 'other';
  readonly name: string;
  readonly line: number;
  readonly depth: number;
}

/**
 * The tokens the walk reads: a namespace, a type declaration, an attribute list, a method's name and
 * its opening parenthesis, braces, and statement ends.
 */
const TOKENS: RegExp =
  /\bnamespace\s+([\w.]+)\s*([;{])|\b(class|struct|record|interface|enum)\s+(?:(?:class|struct)\s+)?(\w+)|\[([^[\]]*)\]|\b(\w+)\s*(?:<[^<>()]*>)?\s*\(|[{};]/g;

/**
 * Words that are followed by a parenthesis without declaring a method.
 */
const NOT_METHODS: ReadonlySet<string> = new Set<string>([
  'if',
  'for',
  'foreach',
  'while',
  'switch',
  'catch',
  'using',
  'lock',
  'return',
  'nameof',
  'typeof',
  'sizeof',
  'default',
  'new',
  'when',
  'base',
  'this',
]);

/**
 * Finds the methods in a C# source that carry any of the given test attributes.
 * @param source The source.
 * @param testAttributes The attribute names that make a method a test, such as `Fact`.
 * @returns Returns the tests, in source order.
 */
export function scanCSharp(
  source: string,
  testAttributes: ReadonlySet<string>,
): readonly ScannedTest[] {
  const code: string = blankCommentsAndStrings(source);
  const lineStarts: number[] = [0];
  for (let index: number = 0; index < code.length; index += 1) {
    if (code.charCodeAt(index) === 10) {
      lineStarts.push(index + 1);
    }
  }
  const lineOf: (offset: number) => number = (offset: number): number => {
    let low: number = 0;
    let high: number = lineStarts.length - 1;
    while (low < high) {
      const middle: number = (low + high + 1) >> 1;
      if (lineStarts[middle] <= offset) {
        low = middle;
      } else {
        high = middle - 1;
      }
    }
    return low + 1;
  };
  const found: ScannedTest[] = [];
  const scopes: Scope[] = [];
  let fileNamespace: string = '';
  let depth: number = 0;
  let pendingType: { kind: 'type' | 'other'; name: string; line: number } | null = null;
  let attributes: string[] = [];
  TOKENS.lastIndex = 0;
  let match: RegExpExecArray | null = TOKENS.exec(code);
  while (match !== null) {
    const token: string = match[0];
    if (match[1] !== undefined) {
      if (match[2] === ';') {
        fileNamespace = match[1];
      } else {
        depth += 1;
        scopes.push({ kind: 'namespace', name: match[1], line: lineOf(match.index), depth });
      }
      attributes = [];
    } else if (match[4] !== undefined) {
      const kind: 'type' | 'other' =
        match[3] === 'interface' || match[3] === 'enum' ? 'other' : 'type';
      pendingType = { kind, name: match[4], line: lineOf(match.index) };
      attributes = [];
    } else if (match[5] !== undefined) {
      attributes.push(...attributeNames(match[5]));
    } else if (match[6] !== undefined) {
      const name: string = match[6];
      if (!NOT_METHODS.has(name) && attributes.length > 0) {
        const tests: readonly string[] = attributes.filter((attribute: string): boolean =>
          testAttributes.has(attribute),
        );
        const types: readonly Scope[] = scopes.filter(
          (scope: Scope): boolean => scope.kind === 'type',
        );
        const enclosing: Scope | undefined = scopes[scopes.length - 1];
        if (tests.length > 0 && enclosing?.kind === 'type' && pendingType === null) {
          const namespaces: string = [
            fileNamespace,
            ...scopes
              .filter((scope: Scope): boolean => scope.kind === 'namespace')
              .map((scope: Scope): string => scope.name),
          ]
            .filter((part: string): boolean => part.length > 0)
            .join('.');
          const typeName: string = types.map((scope: Scope): string => scope.name).join('+');
          found.push({
            className: namespaces.length > 0 ? `${namespaces}.${typeName}` : typeName,
            classLine: enclosing.line,
            method: name,
            line: lineOf(match.index),
            attributes: tests,
          });
        }
        attributes = [];
      }
    } else if (token === '{') {
      depth += 1;
      scopes.push(
        pendingType === null
          ? { kind: 'other', name: '', line: lineOf(match.index), depth }
          : { kind: pendingType.kind, name: pendingType.name, line: pendingType.line, depth },
      );
      pendingType = null;
      attributes = [];
    } else if (token === '}') {
      if (scopes.length > 0 && scopes[scopes.length - 1].depth === depth) {
        scopes.pop();
      }
      depth = Math.max(0, depth - 1);
      attributes = [];
    } else if (token === ';') {
      // A declaration with no body, such as a positional record, opens no scope.
      pendingType = null;
    }
    match = TOKENS.exec(code);
  }
  return found;
}
