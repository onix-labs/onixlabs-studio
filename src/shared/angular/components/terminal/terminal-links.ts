/**
 * Represents an address or path found in a line of terminal output, by its span in that line.
 */
export interface TerminalTextMatch {
  /**
   * Gets the index in the line of the match's first character.
   */
  readonly start: number;

  /**
   * Gets the index in the line just past the match's last character.
   */
  readonly end: number;
}

/**
 * Represents a web address found in terminal output.
 */
export interface TerminalUrlMatch extends TerminalTextMatch {
  /**
   * Gets the address, without the punctuation that ended the sentence around it.
   */
  readonly url: string;
}

/**
 * Represents something in terminal output shaped like a file path, with the position a compiler, a
 * linter or a test runner printed after it. Whether the file exists is for the caller to find out.
 */
export interface TerminalPathMatch extends TerminalTextMatch {
  /**
   * Gets the path as printed: absolute, or relative to the terminal's working directory.
   */
  readonly path: string;

  /**
   * Gets the 1-based line printed with the path, or null when none was.
   */
  readonly line: number | null;

  /**
   * Gets the 1-based column printed with the path, or null when none was.
   */
  readonly column: number | null;
}

/**
 * Holds the longest stretch of a line, in characters, searched for links. A program that prints a
 * megabyte without a newline would otherwise be searched in full on every hover.
 */
export const MAX_LINK_LINE_LENGTH: number = 2048;

/**
 * Holds the most path candidates checked on one line. Each costs a look at the disk, and a line with
 * more than this is a listing, not a message pointing at a file.
 */
const MAX_PATH_CANDIDATES: number = 16;

/**
 * Matches the start of a web address and everything up to the next character that cannot be in one.
 * What comes off the end is decided by {@link trimUrl}. A backslash is never part of an address, and
 * ends one printed inside an escaped string (`printf '…5173/\n'`).
 */
const URL_PATTERN: RegExp = /https?:\/\/[^\s<>"'`\\]+/g;

/**
 * Holds the characters that end a sentence rather than an address, when they are its last character.
 */
const TRAILING_PUNCTUATION: string = '.,;:!?\'"';

/**
 * Maps each closing bracket to its opener. A closing bracket ends an address only when the address
 * did not open it, so `https://en.wikipedia.org/wiki/Mercury_(planet)` keeps its own bracket while
 * `(see https://example.com)` loses the one around it.
 */
const BRACKETS: Readonly<Record<string, string>> = { ')': '(', ']': '[', '}': '{' };

/**
 * Matches a path in the shapes tools print it: an optional drive, root or `./` / `../`, any number of
 * directories, and a file name with an extension — then the position, as `:line`, `:line:column`,
 * `(line)` or `(line,column)`. It may not begin in the middle of a word or another path.
 *
 * An extension is required, and must start with a letter. Without one, every word on the screen
 * would be a candidate; with it, version numbers and decimals are not.
 */
const PATH_PATTERN: RegExp =
  /(?<![\w./\\@+~-])((?:[A-Za-z]:[\\/]|\.{1,2}[\\/]|[\\/])?(?:[\w.@+-]+[\\/])*[\w@+-][\w.@+-]*\.[A-Za-z]\w*)(?::(\d+)(?::(\d+))?|\((\d+)(?:,\s*(\d+))?\))?/g;

/**
 * Matches the frame line of a Python traceback: `File "app/main.py", line 42`. The path is quoted and
 * the line is spelled out, so the general pattern finds the path but not where in it to go.
 */
const PYTHON_FRAME_PATTERN: RegExp = /File "([^"]+)", line (\d+)/g;

/**
 * Finds the web addresses in a line of terminal output.
 * @param text The line, with any rows the terminal wrapped it onto joined back up.
 * @returns Returns the addresses, in the order they appear.
 */
export function findTerminalUrls(text: string): readonly TerminalUrlMatch[] {
  const matches: TerminalUrlMatch[] = [];
  for (const match of text.slice(0, MAX_LINK_LINE_LENGTH).matchAll(URL_PATTERN)) {
    const url: string = trimUrl(match[0]);
    if (isWebAddress(url)) {
      matches.push({ start: match.index, end: match.index + url.length, url });
    }
  }
  return matches;
}

/**
 * Finds what looks like a file path in a line of terminal output, skipping anything inside an
 * address. The paths are candidates only: most will not exist, and the caller links only those that
 * do.
 * @param text The line, with any rows the terminal wrapped it onto joined back up.
 * @param urls The addresses already found in the line, which no path may overlap.
 * @returns Returns the candidates, in the order they appear.
 */
export function findTerminalPaths(
  text: string,
  urls: readonly TerminalTextMatch[],
): readonly TerminalPathMatch[] {
  const searched: string = text.slice(0, MAX_LINK_LINE_LENGTH);
  const matches: TerminalPathMatch[] = [];
  const taken: TerminalTextMatch[] = [...urls];
  const accept: (match: TerminalPathMatch) => void = (match: TerminalPathMatch): void => {
    if (
      matches.length < MAX_PATH_CANDIDATES &&
      !taken.some((other: TerminalTextMatch): boolean => overlaps(other, match))
    ) {
      matches.push(match);
      taken.push(match);
    }
  };

  // Python's frames first: they say where in the file to go, and the general pattern would otherwise
  // claim the same path without its line.
  for (const match of searched.matchAll(PYTHON_FRAME_PATTERN)) {
    const start: number = match.index + match[0].indexOf('"') + 1;
    accept({
      start,
      end: start + match[1].length,
      path: match[1],
      line: Number(match[2]),
      column: null,
    });
  }

  for (const match of searched.matchAll(PATH_PATTERN)) {
    const line: string | undefined = match[2] ?? match[4];
    const column: string | undefined = match[3] ?? match[5];
    accept({
      start: match.index,
      end: match.index + match[0].length,
      path: match[1],
      line: line === undefined ? null : Number(line),
      column: column === undefined ? null : Number(column),
    });
  }

  return matches.sort((a: TerminalPathMatch, b: TerminalPathMatch): number => a.start - b.start);
}

/**
 * Resolves a path printed in a terminal to an absolute one, normalised to forward slashes, with `.`
 * and `..` segments collapsed.
 * @param cwd The terminal's working directory, against which a relative path resolves; null when it
 * is not known.
 * @param path The path as printed.
 * @returns Returns the absolute path, or null when the path is relative and there is no directory to
 * resolve it against.
 */
export function resolveTerminalPath(cwd: string | null, path: string): string | null {
  const slashed: string = path.replace(/\\/g, '/');
  const absolute: boolean = /^(?:[A-Za-z]:)?\//.test(slashed);
  if (!absolute && cwd === null) {
    return null;
  }
  const joined: string = absolute ? slashed : `${(cwd ?? '').replace(/\\/g, '/')}/${slashed}`;
  const drive: string = /^[A-Za-z]:/.exec(joined)?.[0] ?? '';
  const segments: string[] = [];
  for (const segment of joined.slice(drive.length).split('/')) {
    if (segment === '..') {
      segments.pop();
    } else if (segment !== '' && segment !== '.') {
      segments.push(segment);
    }
  }
  return `${drive}/${segments.join('/')}`;
}

/**
 * Takes the punctuation of the surrounding sentence off the end of an address.
 * @param candidate The address as matched, up to the first character that cannot be in one.
 * @returns Returns the address.
 */
function trimUrl(candidate: string): string {
  let url: string = candidate;
  while (url.length > 0) {
    const last: string = url[url.length - 1];
    const opener: string | undefined = BRACKETS[last];
    if (
      TRAILING_PUNCTUATION.includes(last) ||
      (opener !== undefined && count(url, last) > count(url, opener))
    ) {
      url = url.slice(0, -1);
    } else {
      break;
    }
  }
  return url;
}

/**
 * Determines whether an address is one a browser can open: it parses, and it names a host.
 * @param url The address.
 * @returns Returns true when the address is usable.
 */
function isWebAddress(url: string): boolean {
  try {
    return new URL(url).hostname.length > 0;
  } catch {
    return false;
  }
}

/**
 * Counts the occurrences of one character in a string.
 * @param text The string.
 * @param character The character to count.
 * @returns Returns the count.
 */
function count(text: string, character: string): number {
  let total: number = 0;
  for (const c of text) {
    if (c === character) {
      total++;
    }
  }
  return total;
}

/**
 * Determines whether two spans of a line share a character.
 * @param a The first span.
 * @param b The second span.
 * @returns Returns true when they overlap.
 */
function overlaps(a: TerminalTextMatch, b: TerminalTextMatch): boolean {
  return a.start < b.end && b.start < a.end;
}
