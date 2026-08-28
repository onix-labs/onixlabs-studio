/**
 * Compiles the glob patterns a language server registers for `workspace/didChangeWatchedFiles` into
 * matchers, so the main process can send it only the file events it asked for. Pure module: no
 * Electron, no file system, so the pattern semantics are unit-testable on their own.
 *
 * The dialect is the LSP one (a subset of VS Code's): `*` matches within a path segment, `?` one
 * character, `**` any number of segments, `{a,b}` alternatives, and `[...]` character classes.
 * Patterns are matched against a path **relative to the watched root**, with forward slashes.
 */

/**
 * Turns one LSP glob into a regular expression over a root-relative, forward-slashed path.
 * @param glob The glob pattern.
 * @returns Returns the compiled matcher.
 */
export function globToRegExp(glob: string): RegExp {
  let source: string = '^';
  let index: number = 0;
  while (index < glob.length) {
    const char: string = glob[index];
    if (char === '*') {
      if (glob[index + 1] === '*') {
        // `**/` swallows whole segments (including none); a trailing `**` swallows the rest.
        if (glob[index + 2] === '/') {
          source += '(?:[^/]*/)*';
          index += 3;
        } else {
          source += '.*';
          index += 2;
        }
      } else {
        source += '[^/]*';
        index += 1;
      }
      continue;
    }
    if (char === '?') {
      source += '[^/]';
    } else if (char === '{') {
      const close: number = glob.indexOf('}', index);
      if (close === -1) {
        source += '\\{';
      } else {
        const alternatives: string[] = glob
          .slice(index + 1, close)
          .split(',')
          .map((alternative: string): string => globToRegExp(alternative).source.slice(1, -1));
        source += `(?:${alternatives.join('|')})`;
        index = close + 1;
        continue;
      }
    } else if (char === '[') {
      const close: number = glob.indexOf(']', index);
      if (close === -1) {
        source += '\\[';
      } else {
        source += glob.slice(index, close + 1);
        index = close + 1;
        continue;
      }
    } else {
      source += char.replace(/[.+^$()|\\]/g, '\\$&');
    }
    index += 1;
  }
  return new RegExp(`${source}$`);
}

/**
 * Decides whether a root-relative path matches any of a server's registered globs.
 * @param relativePath The changed entry's path relative to the watched root (either separator).
 * @param matchers The compiled patterns.
 * @returns Returns true when at least one pattern matches.
 */
export function matchesAny(relativePath: string, matchers: readonly RegExp[]): boolean {
  const normalised: string = relativePath.replace(/\\/g, '/');
  return matchers.some((matcher: RegExp): boolean => matcher.test(normalised));
}
