import { isAbsolute, relative, resolve } from 'node:path';

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
  return roots.some((root: string): boolean => {
    const resolvedRoot: string = resolve(root);
    if (resolvedTarget === resolvedRoot) {
      return true;
    }
    const rel: string = relative(resolvedRoot, resolvedTarget);
    return rel.length > 0 && !rel.startsWith('..') && !isAbsolute(rel);
  });
}
