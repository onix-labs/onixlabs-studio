import { isAbsolute, relative, resolve, sep } from 'node:path';

/**
 * The built-in file-writing tools whose target path must stay within the run's allowed roots (#307).
 * These take a filesystem path in their input, so a resolved target can be range-checked before the
 * write runs. The studio in-app editor tools (edit/insert/replace the live document) and every
 * read-only tool are intentionally excluded: the editor tools act on the open buffer the user can
 * see and undo, not an arbitrary path, and reads are out of scope for write confinement.
 */
export const CONFINED_WRITE_TOOLS: readonly string[] = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'];

/**
 * The input keys a confined write tool carries its target path under: `file_path` for Write/Edit/
 * MultiEdit, `notebook_path` for NotebookEdit, and `path` as a defensive fallback.
 */
const PATH_KEYS: readonly string[] = ['file_path', 'notebook_path', 'path'];

/**
 * Extracts the filesystem path a confined write tool targets, or null when the input carries none.
 * @param input The tool input.
 * @returns Returns the target path string, or null when absent.
 */
export function writeTargetPath(input: unknown): string | null {
  if (input === null || typeof input !== 'object') {
    return null;
  }
  const record: Record<string, unknown> = input as Record<string, unknown>;
  for (const key of PATH_KEYS) {
    const value: unknown = record[key];
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }
  return null;
}

/**
 * Determines whether a write to a target path is allowed given the run's confinement roots. The
 * target is resolved against the first root (the run's working directory, matching the SDK's `cwd`),
 * so a relative path is anchored to the workspace rather than the app's process directory; an
 * absolute target is checked as-is. A target is allowed when it equals or sits beneath any root.
 *
 * This is a textual `..`/absolute-path normalisation (as `additionalDirectories` itself uses); it is
 * defence-in-depth atop the interactive prompt, not a sandbox — it does not resolve symlinks, so a
 * symlink planted inside a root is out of its remit (the OS sandbox covers the shell path).
 * @param target The write target path from the tool input.
 * @param roots The absolute confinement roots; the first is the run's working directory.
 * @returns Returns true when the write is within the roots, false when it escapes them.
 */
export function isWriteWithinRoots(target: string, roots: readonly string[]): boolean {
  if (roots.length === 0) {
    return true;
  }
  const base: string = roots[0];
  const resolvedTarget: string = isAbsolute(target) ? resolve(target) : resolve(base, target);
  return roots.some((root: string): boolean => isWithin(resolvedTarget, resolve(root)));
}

/**
 * Determines whether a write to a target path is blocked by the user's deny list (#310), consulted
 * even inside an allowed root as a sharper guard than the coarse root check. A deny entry is either an
 * **absolute path** (blocks the target when it equals or sits beneath it) or a bare **path segment**
 * (blocks the target when any segment of its resolved path equals it — e.g. `.git`, `.env`, `secrets`,
 * `node_modules`). Full glob patterns are a deliberate later addition, not a first cut.
 * @param target The write target path from the tool input.
 * @param denyList The user's deny entries (absolute paths or path segments).
 * @param base The directory a relative target resolves against (the run's working directory).
 * @returns Returns true when the write is denied.
 */
export function isWriteDenied(
  target: string,
  denyList: readonly string[],
  base: string,
): boolean {
  if (denyList.length === 0) {
    return false;
  }
  const resolvedTarget: string = isAbsolute(target) ? resolve(target) : resolve(base, target);
  const segments: readonly string[] = resolvedTarget.split(sep).filter((s: string): boolean => s.length > 0);
  return denyList.some((entry: string): boolean => {
    if (entry.length === 0) {
      return false;
    }
    if (isAbsolute(entry)) {
      const resolvedEntry: string = resolve(entry);
      return resolvedTarget === resolvedEntry || isWithin(resolvedTarget, resolvedEntry);
    }
    return segments.includes(entry);
  });
}

/**
 * Sanitises a configured write-path list from an untrusted run request (#310): keeps only non-empty
 * strings, and — for the allow list — only absolute paths (a relative allowed directory has no
 * well-defined meaning across runs).
 * @param value The raw value from the request.
 * @param requireAbsolute Whether to drop non-absolute entries (true for the allow list).
 * @returns Returns the cleaned list (empty when there is nothing usable).
 */
export function sanitizeWritePaths(value: unknown, requireAbsolute: boolean): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((entry: unknown): entry is string => typeof entry === 'string')
    .map((entry: string): string => entry.trim())
    .filter((entry: string): boolean => entry.length > 0 && (!requireAbsolute || isAbsolute(entry)));
}

/**
 * Determines whether a resolved target path equals or sits beneath a resolved root, by textual
 * `..`-normalised containment (not symlink-resolving — this is defence-in-depth, not a sandbox).
 * @param resolvedTarget The already-resolved absolute target.
 * @param resolvedRoot The already-resolved absolute root.
 * @returns Returns true when the target is within the root.
 */
function isWithin(resolvedTarget: string, resolvedRoot: string): boolean {
  if (resolvedTarget === resolvedRoot) {
    return true;
  }
  const rel: string = relative(resolvedRoot, resolvedTarget);
  return rel.length > 0 && !rel.startsWith('..') && !isAbsolute(rel);
}
