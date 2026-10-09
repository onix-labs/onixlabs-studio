/**
 * The text half of Replace in Files (#882): given a file's text and a query, produce the replaced text.
 * Pure — no file access — so the rules can be tested on their own, and the search manager supplies the
 * I/O and the confinement around them.
 *
 * It follows ripgrep's rules for what matches, so a replace changes what the search found:
 *
 *   - **One line at a time.** ripgrep never matches across a line break, so neither does this — a
 *     pattern such as `\s+` that a whole-text regular expression would run across lines is held to one.
 *   - **Whole word** is the query wrapped in word boundaries, as `--word-regexp` does.
 *   - **Case** is ignored unless the search was case-sensitive.
 *
 * And it uses ripgrep's own position for a single match: a byte offset into the line.
 */

/**
 * The query and replacement a replace runs with.
 */
export interface ReplaceOptions {
  /**
   * Gets the text, or the pattern when {@link regexp} is set.
   */
  readonly query: string;

  /**
   * Gets whether the match is case-sensitive.
   */
  readonly caseSensitive: boolean;

  /**
   * Gets whether only whole words match.
   */
  readonly wholeWord: boolean;

  /**
   * Gets whether {@link query} is a regular expression.
   */
  readonly regexp: boolean;

  /**
   * Gets the replacement: literal, or naming the pattern's groups when {@link regexp} is set.
   */
  readonly replacement: string;
}

/**
 * What a replace did to a text.
 */
export interface ReplaceOutcome {
  /**
   * Gets the text after the replace.
   */
  readonly text: string;

  /**
   * Gets how many matches were replaced.
   */
  readonly count: number;
}

/**
 * Builds the expression a query matches with, or null when the query is not a valid pattern.
 * @param options The query.
 * @returns Returns a global expression, or null.
 */
export function matcherFor(options: ReplaceOptions): RegExp | null {
  const pattern: string = options.regexp
    ? options.query
    : options.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const bounded: string = options.wholeWord ? `\\b(?:${pattern})\\b` : pattern;
  try {
    return new RegExp(bounded, options.caseSensitive ? 'g' : 'gi');
  } catch {
    return null;
  }
}

/**
 * Replaces every match of a query in a text, line by line.
 * @param text The text.
 * @param options The query and replacement.
 * @returns Returns the replaced text and how many matches were replaced.
 */
export function replaceAll(text: string, options: ReplaceOptions): ReplaceOutcome {
  const matcher: RegExp | null = matcherFor(options);
  if (matcher === null || options.query.length === 0) {
    return { text, count: 0 };
  }
  let count: number = 0;
  const replaced: string = mapLines(text, (line: string): string =>
    line.replace(matcher, (...args: unknown[]): string => {
      count += 1;
      return replacementFor(options, args);
    }),
  );
  return { text: replaced, count };
}

/**
 * Replaces the one match a search reported, found by its line and ripgrep's byte offset into it.
 * Nothing else on the line changes, and nothing at all when the match is no longer there — the file
 * may have changed since it was searched.
 * @param text The text.
 * @param options The query and replacement.
 * @param line The one-based line of the match.
 * @param column The one-based column of the match: its byte offset into the line, plus one.
 * @returns Returns the replaced text and how many matches were replaced (one, or none).
 */
export function replaceAt(
  text: string,
  options: ReplaceOptions,
  line: number,
  column: number,
): ReplaceOutcome {
  const matcher: RegExp | null = matcherFor(options);
  if (matcher === null || options.query.length === 0) {
    return { text, count: 0 };
  }
  const byteOffset: number = column - 1;
  let count: number = 0;
  let lineNumber: number = 0;
  const replaced: string = mapLines(text, (content: string): string => {
    lineNumber += 1;
    if (lineNumber !== line) {
      return content;
    }
    return content.replace(matcher, (...args: unknown[]): string => {
      const match: string = args[0] as string;
      const index: number = args.find((arg: unknown): boolean => typeof arg === 'number') as number;
      if (count > 0 || Buffer.byteLength(content.slice(0, index), 'utf8') !== byteOffset) {
        return match;
      }
      count = 1;
      return replacementFor(options, args);
    });
  });
  return { text: replaced, count };
}

/**
 * Applies a mapping to each line of a text, keeping its line endings exactly as they were — a file of
 * CRLF lines stays one.
 * @param text The text.
 * @param map Maps one line's content, without its ending.
 * @returns Returns the mapped text.
 */
function mapLines(text: string, map: (line: string) => string): string {
  const parts: string[] = text.split(/(\r\n|\n|\r)/);
  // Even indices are line content; odd ones are the endings the split kept.
  return parts
    .map((part: string, index: number): string => (index % 2 === 0 ? map(part) : part))
    .join('');
}

/**
 * Builds a match's replacement: the replacement as written when the query is literal, or with the
 * pattern's group references filled in when it is a regular expression.
 * @param options The query and replacement.
 * @param args The arguments `String.prototype.replace` passed its replacer: the match, the groups, the
 * offset, the whole string and, when the pattern names groups, the named groups.
 * @returns Returns the replacement for this match.
 */
function replacementFor(options: ReplaceOptions, args: readonly unknown[]): string {
  if (!options.regexp) {
    return options.replacement;
  }
  const offsetAt: number = args.findIndex((arg: unknown): boolean => typeof arg === 'number');
  const match: string = args[0] as string;
  const groups: readonly (string | undefined)[] = args.slice(1, offsetAt) as (string | undefined)[];
  const named: Readonly<Record<string, string | undefined>> =
    typeof args.at(-1) === 'object' && args.at(-1) !== null
      ? (args.at(-1) as Record<string, string | undefined>)
      : {};
  return options.replacement.replace(
    /\$(\$|&|<([^>]+)>|(\d{1,2}))/g,
    (whole: string, token: string, name?: string, digits?: string): string => {
      if (token === '$') {
        return '$';
      }
      if (token === '&') {
        return match;
      }
      if (name !== undefined) {
        return named[name] ?? '';
      }
      const group: number = Number(digits);
      return group >= 1 && group <= groups.length ? (groups[group - 1] ?? '') : whole;
    },
  );
}
