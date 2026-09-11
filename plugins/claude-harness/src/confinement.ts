// Where a turn may write, and what it may reach.
//
// ⚠️ Reproduced from Studio's `write-confinement.ts` and `network-locations.ts`, and this is the one
// place in the port where reproducing rather than importing is worth stating plainly: **the boundary
// itself is Studio's, and it arrives in the turn envelope.** What lives here is only the arithmetic
// that applies it. A harness that computed its own allowed paths would be a harness deciding what the
// user permitted, which is exactly backwards.
//
// ⛔ Textual `..`-normalised containment, not a sandbox. It does not resolve symlinks, so a symlink
// planted inside a root is out of its remit — the OS sandbox (see `sandboxFor`) covers the shell path,
// which is the one this cannot range-check anyway.

import { isAbsolute, relative, resolve, sep } from 'node:path';

/**
 * The built-in file-writing tools whose target path must stay within the run's allowed roots.
 *
 * These take a filesystem path in their input, so a resolved target can be range-checked before the
 * write runs. Studio's in-app editor tools and every read-only tool are excluded on purpose: the editor
 * tools act on an open buffer the user can see and undo rather than an arbitrary path, and reads are
 * out of scope for write confinement.
 */
export const CONFINED_WRITE_TOOLS: readonly string[] = [
  'Write',
  'Edit',
  'MultiEdit',
  'NotebookEdit',
];

/**
 * The input keys a confined write tool carries its target path under: `file_path` for Write/Edit/
 * MultiEdit, `notebook_path` for NotebookEdit, and `path` as a defensive fallback.
 */
const PATH_KEYS: readonly string[] = ['file_path', 'notebook_path', 'path'];

/**
 * Extracts the filesystem path a confined write tool targets, or null when the input carries none.
 * @param input The tool input.
 * @returns Returns the target path, or null when absent.
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
 * Determines whether a resolved target equals or sits beneath a resolved root.
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

/**
 * Determines whether a write is allowed given the run's confinement roots.
 *
 * The target resolves against the first root — the run's working directory, matching the SDK's `cwd` —
 * so a relative path anchors to the workspace rather than to wherever this process happens to be.
 * @param target The write target from the tool input.
 * @param roots The absolute confinement roots; the first is the working directory.
 * @returns Returns true when the write is within the roots.
 */
export function isWriteWithinRoots(target: string, roots: readonly string[]): boolean {
  if (roots.length === 0) {
    return true;
  }
  const resolvedTarget: string = isAbsolute(target) ? resolve(target) : resolve(roots[0], target);
  return roots.some((root: string): boolean => isWithin(resolvedTarget, resolve(root)));
}

/**
 * Determines whether a write is blocked by the user's deny list, which is consulted even inside an
 * allowed root as a sharper guard than the coarse root check.
 *
 * A deny entry is either an **absolute path** (blocking the target when it equals or sits beneath it)
 * or a bare **path segment** (blocking the target when any segment of its resolved path equals it —
 * `.git`, `.env`, `secrets`, `node_modules`).
 * @param target The write target from the tool input.
 * @param denyList The user's deny entries.
 * @param base The directory a relative target resolves against.
 * @returns Returns true when the write is denied.
 */
export function isWriteDenied(target: string, denyList: readonly string[], base: string): boolean {
  if (denyList.length === 0) {
    return false;
  }
  const resolvedTarget: string = isAbsolute(target) ? resolve(target) : resolve(base, target);
  const segments: readonly string[] = resolvedTarget
    .split(sep)
    .filter((segment: string): boolean => segment.length > 0);
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
 * Keeps only the absolute entries of a deny list, dropping the bare segments.
 *
 * ⛔ A bare segment such as `.git` is a pattern the gate understands and the OS sandbox does not, so it
 * stays gate-only rather than being mistranslated into a path that would silently match nothing.
 * @param entries The configured deny entries.
 * @returns Returns the absolute entries.
 */
export function absolutePathsOf(entries: readonly string[]): string[] {
  return entries.filter((entry: string): boolean => isAbsolute(entry));
}

/**
 * Expands configured network patterns into the set the sandbox is given.
 *
 * 🔑 The one convenience over the sandbox's own rule: `*.example.com` is taken to mean the sub-domains
 * **and** the domain itself, because that is what a person writing it means. The sandbox matches
 * label-for-label and cannot express that in one pattern, so the apex is added as a second entry and
 * both sides then agree.
 * @param patterns The configured patterns.
 * @returns Returns the patterns to match against, apexes included.
 */
export function expandNetworkLocations(patterns: readonly string[]): readonly string[] {
  const expanded: string[] = [];
  for (const pattern of patterns) {
    expanded.push(pattern);
    if (pattern.startsWith('*.')) {
      expanded.push(pattern.slice(2));
    }
  }
  return [...new Set<string>(expanded)];
}
