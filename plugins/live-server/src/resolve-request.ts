// Turns a request's path into a file inside the served folder, or refuses it (#1062).
//
// ⛔ This is the one place a request reaches the disk, so it is strict, and it checks the path the disk
// will actually open rather than the text that was asked for:
// - the path is decoded once, and a path that does not decode, or holds a NUL or a backslash, is refused;
// - a `..` segment is refused outright rather than resolved, so `/../secret` is an error and not a
//   different file that happens to be inside;
// - a name starting with `.` — `.git`, `.env` — is not served, and neither is anything under one;
// - the file's real path, its links followed, must still be inside the folder's real path;
// - a folder is served as its `index.html` or not at all: there are no listings.
import { promises as fs } from 'node:fs';
import type { Stats } from 'node:fs';
import * as path from 'node:path';

/**
 * What a request's path resolved to.
 */
export type ResolvedRequest =
  | {
      /**
       * Discriminates a file to serve.
       */
      readonly kind: 'file';

      /**
       * Gets the file's real path.
       */
      readonly file: string;
    }
  | {
      /**
       * Discriminates a folder asked for without its trailing slash, which is redirected so its page's
       * relative links resolve inside it.
       */
      readonly kind: 'redirect';

      /**
       * Gets where to redirect to.
       */
      readonly location: string;
    }
  | {
      /**
       * Discriminates a path that names nothing served.
       */
      readonly kind: 'not-found';
    }
  | {
      /**
       * Discriminates a path that tries to leave the folder, or cannot be read as a path at all.
       */
      readonly kind: 'forbidden';
    };

/**
 * Splits a request target into its path, dropping the query and fragment.
 * @param target The request target, as the request line carried it.
 * @returns Returns the still-encoded path.
 */
export function pathOf(target: string): string {
  const end: number = target.search(/[?#]/);
  return end < 0 ? target : target.slice(0, end);
}

/**
 * Decodes a request's path into its segments, refusing anything that is not a plain path inside.
 * @param encoded The still-encoded path, starting with `/`.
 * @returns Returns the segments, empty for the folder itself, or null when the path is refused.
 */
export function segmentsOf(encoded: string): readonly string[] | null {
  if (!encoded.startsWith('/')) {
    return null;
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(encoded);
  } catch {
    return null;
  }
  if (decoded.includes('\0') || decoded.includes('\\')) {
    return null;
  }
  const segments: string[] = decoded
    .split('/')
    .filter((segment: string): boolean => segment !== '');
  if (segments.some((segment: string): boolean => segment === '..' || segment === '.')) {
    return null;
  }
  return segments;
}

/**
 * Determines whether a real path lies inside a real folder, or is the folder.
 * @param root The folder's real path.
 * @param target The real path to test.
 * @returns Returns true when it does.
 */
export function isInside(root: string, target: string): boolean {
  return target === root || target.startsWith(root.endsWith(path.sep) ? root : root + path.sep);
}

/**
 * Describes an entry found inside the folder.
 */
interface FoundEntry {
  /**
   * Gets its real path.
   */
  readonly real: string;

  /**
   * Gets what it is.
   */
  readonly stats: Stats;
}

/**
 * What following a path found: an entry inside, nothing, or something outside the folder.
 */
type Lookup = FoundEntry | null | 'outside';

/**
 * Follows a path's links and stats where it lands, confined to the folder.
 * @param root The folder's real path.
 * @param candidate The path to follow.
 * @returns Returns its real path and what it is, or null when it is missing or outside.
 */
async function realInside(root: string, candidate: string): Promise<Lookup> {
  let real: string;
  try {
    real = await fs.realpath(candidate);
  } catch {
    return null;
  }
  if (!isInside(root, real)) {
    return 'outside';
  }
  try {
    return { real, stats: await fs.stat(real) };
  } catch {
    return null;
  }
}

/**
 * Resolves a request's path to what is served for it.
 * @param root The served folder's real path.
 * @param target The request target, as the request line carried it.
 * @returns Returns what to serve, redirect to, or refuse.
 */
export async function resolveRequest(root: string, target: string): Promise<ResolvedRequest> {
  const encoded: string = pathOf(target);
  const segments: readonly string[] | null = segmentsOf(encoded);
  if (segments === null) {
    return { kind: 'forbidden' };
  }
  if (segments.some((segment: string): boolean => segment.startsWith('.'))) {
    return { kind: 'not-found' };
  }
  const found: Lookup = await realInside(root, path.join(root, ...segments));
  if (found === 'outside') {
    return { kind: 'forbidden' };
  }
  if (found === null) {
    return { kind: 'not-found' };
  }
  if (found.stats.isFile()) {
    return { kind: 'file', file: found.real };
  }
  if (!found.stats.isDirectory()) {
    return { kind: 'not-found' };
  }
  if (!encoded.endsWith('/')) {
    // Built from the checked segments, never from the request: `//example.com` would otherwise come
    // back as a Location the browser reads as another site.
    const location: string = segments
      .map((segment: string): string => `/${encodeURIComponent(segment)}`)
      .join('');
    return { kind: 'redirect', location: `${location}/` };
  }
  const index: Lookup = await realInside(root, path.join(found.real, 'index.html'));
  if (index === 'outside') {
    return { kind: 'forbidden' };
  }
  return index?.stats.isFile() === true
    ? { kind: 'file', file: index.real }
    : { kind: 'not-found' };
}
