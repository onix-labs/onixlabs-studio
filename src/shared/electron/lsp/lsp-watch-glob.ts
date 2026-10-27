import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

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

/**
 * Compiles one `FileSystemWatcher.globPattern` of a registration into a matcher over paths relative
 * to the watched root.
 *
 * A plain string is relative to the root. A `RelativePattern` (`{ baseUri, pattern }`) is relative to
 * its own base folder, which may be a sub-folder of the root (Roslyn registers one per project) — the
 * base's place under the root is prefixed onto the pattern. A base, or an absolute string pattern,
 * outside the root names files the root watcher cannot see, so it compiles to nothing rather than to
 * "everything".
 * @param glob The registered glob pattern, untrusted.
 * @param root The absolute watched root.
 * @returns Returns the matcher, or null when the pattern names nothing under the root.
 */
export function compileWatchPattern(glob: unknown, root: string): RegExp | null {
  if (typeof glob === 'string') {
    if (glob.startsWith('file:') || path.isAbsolute(glob)) {
      return underRoot(glob.startsWith('file:') ? safeFilePath(glob) : glob, root, '');
    }
    return globToRegExp(glob);
  }
  if (typeof glob !== 'object' || glob === null) {
    return null;
  }
  const relative: { baseUri?: unknown; pattern?: unknown } = glob;
  if (typeof relative.pattern !== 'string') {
    return null;
  }
  // `baseUri` is a URI string, or (protocol 3.17) a workspace folder carrying one.
  const base: unknown =
    typeof relative.baseUri === 'object' && relative.baseUri !== null
      ? (relative.baseUri as { uri?: unknown }).uri
      : relative.baseUri;
  if (typeof base !== 'string') {
    return globToRegExp(relative.pattern);
  }
  const basePath: string | null = base.startsWith('file:') ? safeFilePath(base) : base;
  return basePath === null ? null : underRoot(basePath, root, relative.pattern);
}

/**
 * Compiles a pattern anchored at an absolute folder (or an absolute glob) into a root-relative
 * matcher, or null when the folder lies outside the root.
 * @param anchor The absolute folder the pattern is relative to, or an absolute glob when `pattern` is
 * empty.
 * @param root The absolute watched root.
 * @param pattern The glob relative to `anchor`, or empty when `anchor` is itself the glob.
 * @returns Returns the matcher, or null.
 */
function underRoot(anchor: string | null, root: string, pattern: string): RegExp | null {
  if (anchor === null) {
    return null;
  }
  const relative: string = path.relative(root, anchor).split(path.sep).join('/');
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return null;
  }
  if (pattern === '') {
    // An absolute glob under the root: its remainder is the root-relative glob itself.
    return relative === '' ? null : globToRegExp(relative);
  }
  if (relative === '') {
    return globToRegExp(pattern);
  }
  // The base is a literal folder, so it is escaped rather than read as glob syntax (a folder named
  // `[draft]` must not become a character class).
  const prefix: string = `${relative}/`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${prefix}${globToRegExp(pattern).source.slice(1)}`);
}

/**
 * Converts a `file:` URI to a path, or null when it is not a usable one.
 * @param uri The URI.
 * @returns Returns the path, or null.
 */
function safeFilePath(uri: string): string | null {
  try {
    return fileURLToPath(uri);
  } catch {
    return null;
  }
}

/**
 * Keeps every `workspace/didChangeWatchedFiles` registration a server has made, by its id, and
 * answers the union of their patterns.
 *
 * ⛔ A server registers many times and unregisters by id. Roslyn makes **623** registrations loading a
 * 70-project solution — one per project per kind of file — and unregisters some as projects reload.
 * Keeping only the last one (as this once did) left the session watching for one project's
 * `obj/project.assets.json`, so the server heard about no file changing on disk after the load:
 * not a branch switch, not a pull, not a file an agent wrote (#1170).
 */
export class WatchRegistrations {
  /**
   * Holds the absolute watched root the patterns are compiled against.
   */
  private readonly root: string;

  /**
   * Holds each live registration's compiled patterns, keyed by registration id.
   */
  private readonly byId: Map<string, readonly RegExp[]> = new Map<string, readonly RegExp[]>();

  /**
   * Initializes a new instance of the {@link WatchRegistrations} class.
   * @param root The absolute watched root the patterns are compiled against.
   */
  public constructor(root: string) {
    this.root = root;
  }

  /**
   * Adds (or replaces) a registration.
   * @param id The registration id.
   * @param watchers The registration's `watchers`, untrusted.
   */
  public register(id: string, watchers: unknown): void {
    const compiled: RegExp[] = [];
    for (const watcher of Array.isArray(watchers) ? watchers : []) {
      const matcher: RegExp | null = compileWatchPattern(
        (watcher as { globPattern?: unknown } | null)?.globPattern,
        this.root,
      );
      if (matcher !== null) {
        compiled.push(matcher);
      }
    }
    this.byId.set(id, compiled);
  }

  /**
   * Removes a registration.
   * @param id The registration id.
   * @returns Returns true when it was known.
   */
  public unregister(id: string): boolean {
    return this.byId.delete(id);
  }

  /**
   * Gets how many registrations are live.
   */
  public get size(): number {
    return this.byId.size;
  }

  /**
   * Gets the patterns to filter by: null when the server has registered nothing (report everything,
   * as a server relying on the client's default watching expects), otherwise the union of every live
   * registration's patterns — possibly empty, when everything it asked for lies outside the root.
   * @returns Returns the patterns, or null.
   */
  public patterns(): readonly RegExp[] | null {
    if (this.byId.size === 0) {
      return null;
    }
    return [...this.byId.values()].flat();
  }
}
