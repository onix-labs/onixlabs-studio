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
