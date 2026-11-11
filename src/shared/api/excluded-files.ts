/**
 * Excluded files and folders (#1252): workspace-relative paths the developer takes out of the
 * explorers, Expand All and Find. The list lives in the workspace's `.studio/workspace.json`, so it is
 * kept with the workspace and shared with whoever clones it.
 *
 * Paths are stored in a canonical form: POSIX separators, relative to the workspace root, with no
 * leading `./`, no trailing `/`, and no `.` or `..` segments. Keep this module platform-neutral: the
 * renderer matches with it and the main process sanitises with it.
 */

/**
 * Holds the longest path accepted.
 */
const MAX_PATH_LENGTH: number = 1024;

/**
 * Holds the most paths one list may carry, bounding untrusted input.
 */
const MAX_PATHS: number = 500;

/**
 * Reduces a workspace-relative path to its canonical form.
 * @param value The path as written, with either separator.
 * @returns Returns the canonical path, or an empty string when the path is absolute, escapes the
 * workspace, names the root itself, or is otherwise unusable.
 */
export function normaliseExcludedFile(value: string): string {
  if (value.length === 0 || value.length > MAX_PATH_LENGTH || /[\n\r\0]/.test(value)) {
    return '';
  }
  const slashed: string = value.trim().replace(/\\/g, '/');
  if (slashed.startsWith('/') || /^[A-Za-z]:/.test(slashed)) {
    return '';
  }
  const segments: string[] = slashed
    .split('/')
    .filter((segment: string) => segment !== '' && segment !== '.');
  if (segments.length === 0 || segments.includes('..')) {
    return '';
  }
  return segments.join('/');
}

/**
 * Cleans a list of excluded paths from a file or an untrusted request.
 * @param value The configured value.
 * @returns Returns the canonical paths, without duplicates, in their original order.
 */
export function sanitizeExcludedFiles(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const paths: string[] = [];
  const seen: Set<string> = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'string') {
      continue;
    }
    const path: string = normaliseExcludedFile(entry);
    if (path === '' || seen.has(path)) {
      continue;
    }
    seen.add(path);
    paths.push(path);
    if (paths.length >= MAX_PATHS) {
      break;
    }
  }
  return paths;
}

/**
 * Determines whether a workspace-relative path is excluded: it is listed, or it sits inside a listed
 * folder.
 * @param relative The canonical workspace-relative path.
 * @param excluded The canonical excluded paths.
 * @returns Returns true when the path is excluded.
 */
export function isExcludedPath(relative: string, excluded: readonly string[]): boolean {
  return excluded.some((entry: string) => relative === entry || relative.startsWith(`${entry}/`));
}

/**
 * Determines whether a workspace-relative path is hidden by convention: any of its segments starts
 * with a dot, so a dotfile and everything inside a dot-folder are hidden alike.
 * @param relative The canonical workspace-relative path.
 * @returns Returns true when the path is hidden.
 */
export function isHiddenPath(relative: string): boolean {
  return relative.split('/').some((segment: string) => segment.startsWith('.'));
}

/**
 * Produces the ripgrep globs that leave the excluded paths out of a search: the path itself, and
 * everything beneath it when it is a folder.
 * @param excluded The canonical excluded paths.
 * @returns Returns the globs, two per path.
 */
export function excludedFileGlobs(excluded: readonly string[]): readonly string[] {
  return excluded.flatMap((path: string) => [`/${path}`, `/${path}/**`]);
}
