import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { globToRegExp } from '@shared/api/lsp-glob';

export { globToRegExp };

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
 * Rewrites one `FileSystemWatcher.globPattern` as a glob relative to the watched root, as
 * {@link compileWatchPattern} reads it, so where it could match can be judged a folder at a time.
 * @param glob The registered glob pattern, untrusted.
 * @param root The absolute watched root.
 * @returns Returns the root-relative glob with `/` separators, or null when it names nothing under
 * the root.
 */
export function rootRelativeGlob(glob: unknown, root: string): string | null {
  if (typeof glob === 'string') {
    if (glob.startsWith('file:') || path.isAbsolute(glob)) {
      const absolute: string | null = glob.startsWith('file:') ? safeFilePath(glob) : glob;
      return absolute === null ? null : relativeUnder(absolute, root, '');
    }
    return glob;
  }
  if (typeof glob !== 'object' || glob === null) {
    return null;
  }
  const relative: { baseUri?: unknown; pattern?: unknown } = glob;
  if (typeof relative.pattern !== 'string') {
    return null;
  }
  const base: unknown =
    typeof relative.baseUri === 'object' && relative.baseUri !== null
      ? (relative.baseUri as { uri?: unknown }).uri
      : relative.baseUri;
  if (typeof base !== 'string') {
    return relative.pattern;
  }
  const basePath: string | null = base.startsWith('file:') ? safeFilePath(base) : base;
  return basePath === null ? null : relativeUnder(basePath, root, relative.pattern);
}

/**
 * Joins an absolute anchor's place under the root onto a pattern.
 * @param anchor The absolute folder, or an absolute glob when `pattern` is empty.
 * @param root The absolute watched root.
 * @param pattern The glob relative to the anchor, or empty.
 * @returns Returns the root-relative glob, or null when the anchor lies outside the root.
 */
function relativeUnder(anchor: string, root: string, pattern: string): string | null {
  const relative: string = path.relative(root, anchor).split(path.sep).join('/');
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return null;
  }
  if (pattern === '') {
    return relative === '' ? null : relative;
  }
  return relative === '' ? pattern : `${relative}/${pattern}`;
}

/**
 * Determines whether some path inside a folder could match a root-relative glob, judging the folder's
 * segments against the glob's leading segments. It errs towards yes: a folder is only ruled out when
 * a literal or wildcard segment of the glob cannot match it.
 * @param directory The folder's segments, relative to the root.
 * @param glob The glob's segments.
 * @returns Returns true when an entry somewhere inside the folder could match.
 */
export function globCouldMatchBeneath(
  directory: readonly string[],
  glob: readonly string[],
): boolean {
  if (directory.length === 0) {
    return glob.length > 0;
  }
  if (glob.length === 0) {
    return false;
  }
  const [head, ...rest]: readonly string[] = glob;
  if (head.includes('**')) {
    return true;
  }
  // A segment with alternatives may hold a separator (`{src/a,lib}`); too clever to rule out.
  if (head.includes('{')) {
    return true;
  }
  return globToRegExp(head).test(directory[0]) && globCouldMatchBeneath(directory.slice(1), rest);
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
   * Holds the union of every live registration's patterns, or null when it must be rebuilt.
   */
  private union: readonly RegExp[] | null = null;

  /**
   * Holds each live registration's patterns as root-relative globs split into segments, keyed by
   * registration id, for judging which folders a poll has to read (#1254).
   */
  private readonly globsById: Map<string, readonly (readonly string[])[]> = new Map<
    string,
    readonly (readonly string[])[]
  >();

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
    const globs: (readonly string[])[] = [];
    for (const watcher of Array.isArray(watchers) ? watchers : []) {
      const pattern: unknown = (watcher as { globPattern?: unknown } | null)?.globPattern;
      const matcher: RegExp | null = compileWatchPattern(pattern, this.root);
      if (matcher !== null) {
        compiled.push(matcher);
        const glob: string | null = rootRelativeGlob(pattern, this.root);
        if (glob !== null) {
          globs.push(glob.split('/').filter((segment: string): boolean => segment !== ''));
        }
      }
    }
    this.byId.set(id, compiled);
    this.globsById.set(id, globs);
    this.union = null;
  }

  /**
   * Removes a registration.
   * @param id The registration id.
   * @returns Returns true when it was known.
   */
  public unregister(id: string): boolean {
    this.union = null;
    this.globsById.delete(id);
    return this.byId.delete(id);
  }

  /**
   * Determines whether a live registration could match something inside a folder, so a poll reads a
   * folder it would otherwise skip (a build output, a dependency cache) when the server asked for
   * what is in it: Roslyn's `obj/project.assets.json` after a restore. False when there are none.
   * @param relativeDirectory The folder's path relative to the watched root (either separator).
   * @returns Returns true when a registration could match an entry inside it.
   */
  public couldMatchBeneath(relativeDirectory: string): boolean {
    const directory: readonly string[] = relativeDirectory
      .split(/[\\/]/)
      .filter((segment: string): boolean => segment !== '');
    for (const globs of this.globsById.values()) {
      if (
        globs.some((glob: readonly string[]): boolean => globCouldMatchBeneath(directory, glob))
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * Determines whether a path matches one of the live registrations. False when there are none: a
   * server that registered nothing asked for nothing in particular.
   * @param relativePath The changed entry's path relative to the watched root (either separator).
   * @returns Returns true when the server asked to hear about the path.
   */
  public matches(relativePath: string): boolean {
    const patterns: readonly RegExp[] | null = this.patterns();
    return patterns !== null && matchesAny(relativePath, patterns);
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
    this.union ??= [...this.byId.values()].flat();
    return this.union;
  }
}
