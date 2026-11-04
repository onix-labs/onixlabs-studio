/**
 * Holds the longest section name matched, as the EditorConfig specification allows no more. `.editorconfig`
 * files arrive with cloned repositories, so what they ask of the matcher has to stay bounded.
 */
const MAX_PATTERN_LENGTH: number = 1024;

/**
 * Holds how many alternatives a section's braces may expand to before the section is ignored.
 */
const MAX_ALTERNATIVES: number = 256;

/**
 * Describes one matching step of a compiled glob.
 */
type GlobToken =
  | { readonly kind: 'literal'; readonly character: string }
  | { readonly kind: 'any' }
  | { readonly kind: 'star' }
  | { readonly kind: 'globstar' }
  | { readonly kind: 'set'; readonly negated: boolean; readonly matches: (c: string) => boolean }
  | { readonly kind: 'number'; readonly low: number; readonly high: number };

/**
 * Finds the brace closing the one opened at an index.
 * @param pattern The pattern.
 * @param open The index of the opening brace.
 * @returns Returns the closing brace's index, or -1 when it is not closed.
 */
function closingBrace(pattern: string, open: number): number {
  let depth: number = 0;
  for (let index: number = open; index < pattern.length; index++) {
    const character: string = pattern[index];
    if (character === '\\') {
      index++;
    } else if (character === '{') {
      depth++;
    } else if (character === '}') {
      depth--;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

/**
 * Splits a brace group's body at its top-level commas.
 * @param body The text between the braces.
 * @returns Returns the choices.
 */
function splitChoices(body: string): string[] {
  const choices: string[] = [];
  let depth: number = 0;
  let start: number = 0;
  for (let index: number = 0; index < body.length; index++) {
    const character: string = body[index];
    if (character === '\\') {
      index++;
    } else if (character === '{') {
      depth++;
    } else if (character === '}') {
      depth--;
    } else if (character === ',' && depth === 0) {
      choices.push(body.slice(start, index));
      start = index + 1;
    }
  }
  choices.push(body.slice(start));
  return choices;
}

/**
 * Expands a pattern's `{a,b}` groups into the plain patterns they stand for. A `{n1..n2}` group, or
 * braces with no comma, stay in place for {@link tokenize} to read.
 * @param pattern The pattern.
 * @returns Returns the alternatives, or null when there would be too many.
 */
function expandBraces(pattern: string): string[] | null {
  for (let index: number = 0; index < pattern.length; index++) {
    const character: string = pattern[index];
    if (character === '\\') {
      index++;
    } else if (character === '[') {
      const close: number = pattern.indexOf(']', index + 1);
      // A set holds no brace group, and one with a slash is no set at all.
      if (close !== -1 && !pattern.slice(index, close).includes('/')) {
        index = close;
      }
    } else if (character === '{') {
      const close: number = closingBrace(pattern, index);
      if (close === -1) {
        continue;
      }
      const choices: string[] = splitChoices(pattern.slice(index + 1, close));
      if (choices.length < 2) {
        continue;
      }
      const results: string[] = [];
      for (const choice of choices) {
        const expanded: string[] | null = expandBraces(
          pattern.slice(0, index) + choice + pattern.slice(close + 1),
        );
        if (expanded === null || results.length + expanded.length > MAX_ALTERNATIVES) {
          return null;
        }
        results.push(...expanded);
      }
      return results;
    }
  }
  return [pattern];
}

/**
 * Reads a `[...]` set from a pattern.
 * @param pattern The pattern.
 * @param open The index of the opening bracket.
 * @returns Returns the token and the index after the set, or null when it is no set.
 */
function readSet(
  pattern: string,
  open: number,
): { readonly token: GlobToken; readonly next: number } | null {
  let index: number = open + 1;
  const negated: boolean = pattern[index] === '!';
  if (negated) {
    index++;
  }
  const start: number = index;
  // A bracket straight after the opening stands for itself.
  if (pattern[index] === ']') {
    index++;
  }
  while (index < pattern.length && pattern[index] !== ']') {
    if (pattern[index] === '/') {
      return null;
    }
    index += pattern[index] === '\\' ? 2 : 1;
  }
  if (index >= pattern.length) {
    return null;
  }
  const body: string = pattern.slice(start, index);
  const singles: Set<string> = new Set<string>();
  const ranges: [string, string][] = [];
  for (let at: number = 0; at < body.length; at++) {
    if (body[at] === '\\' && at + 1 < body.length) {
      at++;
      singles.add(body[at]);
    } else if (body[at + 1] === '-' && at + 2 < body.length) {
      ranges.push([body[at], body[at + 2]]);
      at += 2;
    } else {
      singles.add(body[at]);
    }
  }
  return {
    token: {
      kind: 'set',
      negated,
      matches: (character: string): boolean =>
        singles.has(character) ||
        ranges.some(
          ([low, high]: [string, string]): boolean => character >= low && character <= high,
        ),
    },
    next: index + 1,
  };
}

/**
 * Compiles one brace-free pattern into matching steps.
 * @param pattern The pattern.
 * @returns Returns the steps.
 */
function tokenize(pattern: string): GlobToken[] {
  const tokens: GlobToken[] = [];
  let index: number = 0;
  while (index < pattern.length) {
    const character: string = pattern[index];
    if (character === '\\' && index + 1 < pattern.length) {
      tokens.push({ kind: 'literal', character: pattern[index + 1] });
      index += 2;
    } else if (character === '*') {
      const double: boolean = pattern[index + 1] === '*';
      tokens.push({ kind: double ? 'globstar' : 'star' });
      index += double ? 2 : 1;
    } else if (character === '?') {
      tokens.push({ kind: 'any' });
      index++;
    } else if (character === '[') {
      const set: { readonly token: GlobToken; readonly next: number } | null = readSet(
        pattern,
        index,
      );
      tokens.push(set?.token ?? { kind: 'literal', character });
      index = set?.next ?? index + 1;
    } else if (character === '{') {
      const range: RegExpExecArray | null = /^\{([+-]?\d+)\.\.([+-]?\d+)\}/.exec(
        pattern.slice(index),
      );
      if (range === null) {
        tokens.push({ kind: 'literal', character });
        index++;
      } else {
        const first: number = Number(range[1]);
        const second: number = Number(range[2]);
        tokens.push({
          kind: 'number',
          low: Math.min(first, second),
          high: Math.max(first, second),
        });
        index += range[0].length;
      }
    } else {
      tokens.push({ kind: 'literal', character });
      index++;
    }
  }
  return tokens;
}

/**
 * Determines whether compiled steps match a whole path. Walks the steps against the positions they can
 * reach rather than backtracking, so a hostile pattern costs its length times the path's.
 * @param tokens The steps.
 * @param path The path.
 * @returns Returns true when the steps consume the whole path.
 */
function matchesTokens(tokens: readonly GlobToken[], path: string): boolean {
  let reachable: Set<number> = new Set<number>([0]);
  for (const token of tokens) {
    const next: Set<number> = new Set<number>();
    for (const position of [...reachable].sort((a: number, b: number): number => a - b)) {
      switch (token.kind) {
        case 'literal':
          if (path[position] === token.character) {
            next.add(position + 1);
          }
          break;
        case 'any':
          if (position < path.length && path[position] !== '/') {
            next.add(position + 1);
          }
          break;
        case 'set':
          if (
            position < path.length &&
            path[position] !== '/' &&
            token.matches(path[position]) !== token.negated
          ) {
            next.add(position + 1);
          }
          break;
        case 'star':
          for (let end: number = position; end <= path.length; end++) {
            next.add(end);
            if (path[end] === '/') {
              break;
            }
          }
          break;
        case 'globstar':
          for (let end: number = position; end <= path.length; end++) {
            next.add(end);
          }
          break;
        case 'number': {
          const digits: RegExpExecArray | null = /^[+-]?\d+/.exec(path.slice(position));
          for (let length: number = 1; digits !== null && length <= digits[0].length; length++) {
            const text: string = digits[0].slice(0, length);
            const value: number = Number(text);
            if (
              !Number.isNaN(value) &&
              value >= token.low &&
              value <= token.high &&
              // `{1..10}` is not met by `007`: a number has one spelling.
              text === String(value)
            ) {
              next.add(position + length);
            }
          }
          break;
        }
      }
    }
    if (next.size === 0) {
      return false;
    }
    reachable = next;
  }
  return reachable.has(path.length);
}

/**
 * Determines whether an `.editorconfig` section name covers a file, under the specification's rules.
 * A name with no slash matches the file's name at any depth; one with a slash is relative to the
 * `.editorconfig`'s folder.
 * @param pattern The section name.
 * @param relativePath The file's path from that folder, with forward slashes.
 * @returns Returns true when the section applies.
 */
export function matchesEditorConfigGlob(pattern: string, relativePath: string): boolean {
  if (pattern.length === 0 || pattern.length > MAX_PATTERN_LENGTH) {
    return false;
  }
  const rooted: string = pattern.includes('/')
    ? pattern.replace(/^\//, '')
    : `**/${pattern}`.replace(/^\*\*\/\*\*/, '**');
  const alternatives: string[] | null = expandBraces(rooted);
  if (alternatives === null) {
    return false;
  }
  return alternatives.some((alternative: string): boolean => {
    if (alternative.startsWith('**/')) {
      // `**/name` covers a file directly in the folder as well as those deeper down.
      return (
        matchesTokens(tokenize(alternative), relativePath) ||
        matchesTokens(tokenize(alternative.slice(3)), relativePath)
      );
    }
    return matchesTokens(tokenize(alternative), relativePath);
  });
}
