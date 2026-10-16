import { existsSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { logger } from '@shared/electron/logger';

/**
 * The built-in file-writing tools whose target path must stay within the run's allowed roots (#307).
 * These take a filesystem path in their input, so a resolved target can be range-checked before the
 * write runs. The studio in-app editor tools (edit/insert/replace the live document) and every
 * read-only tool are intentionally excluded: the editor tools act on the open buffer the user can
 * see and undo, not an arbitrary path, and reads are out of scope for write confinement.
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
      logger.trace('WriteConfinement', `Resolved write target path '${value}' (key=${key})`);
      return value;
    }
  }
  return null;
}

/**
 * Resolves a path to where it really is: symbolic links followed, for as much of the path as exists.
 *
 * A write's target usually does not exist yet, so the longest existing prefix is resolved and the
 * rest appended. That is what catches the escape that textual `..`-normalisation cannot: a link
 * planted inside a root (`ws/out -> ../../elsewhere`, checked out of a cloned repository or made by
 * the agent's own shell) names a place outside it, and `ws/out/file` is a write to that place
 * (audit S8).
 * @param resolved An absolute, `..`-normalised path.
 * @returns Returns the real path, or the path as given when nothing of it exists.
 */
export function realPathOf(resolved: string): string {
  let existing: string = resolved;
  const trailing: string[] = [];
  while (!existsSync(existing)) {
    const parent: string = dirname(existing);
    if (parent === existing) {
      return resolved;
    }
    trailing.unshift(existing.slice(parent.length + (parent.endsWith(sep) ? 0 : 1)));
    existing = parent;
  }
  try {
    return join(realpathSync.native(existing), ...trailing);
  } catch {
    return resolved;
  }
}

/**
 * Determines whether a write to a target path is allowed given the run's confinement roots. The
 * target is resolved against the first root (the run's working directory, matching the SDK's `cwd`),
 * so a relative path is anchored to the workspace rather than the app's process directory; an
 * absolute target is checked as-is. A target is allowed when it equals or sits beneath any root.
 *
 * Both sides are compared where they really are: `..` normalised and symbolic links followed, so a
 * link inside a root that points outside it does not count as inside, and a root reached through a
 * link (`/var` → `/private/var`) still contains its own files. Defence-in-depth atop the interactive
 * prompt, not a sandbox; the OS sandbox covers the shell path.
 * @param target The write target path from the tool input.
 * @param roots The absolute confinement roots; the first is the run's working directory.
 * @returns Returns true when the write is within the roots, false when it escapes them.
 */
export function isWriteWithinRoots(target: string, roots: readonly string[]): boolean {
  if (roots.length === 0) {
    logger.trace('WriteConfinement', `No confinement roots; allowing write to '${target}'`);
    return true;
  }
  const base: string = roots[0];
  const resolvedTarget: string = realPathOf(
    isAbsolute(target) ? resolve(target) : resolve(base, target),
  );
  const within: boolean = roots.some((root: string): boolean =>
    isWithin(resolvedTarget, realPathOf(resolve(root))),
  );
  logger.debug(
    'WriteConfinement',
    `Confinement check for '${resolvedTarget}': ${within ? 'in-root' : 'out-of-root'}`,
  );
  return within;
}

/**
 * Determines whether a write to a target path is blocked by the user's deny list (#310), consulted
 * even inside an allowed root as a sharper guard than the coarse root check. A deny entry is either an
 * **absolute path** (blocks the target when it equals or sits beneath it) or a bare **path segment**
 * (blocks the target when any segment of its resolved path equals it — e.g. `.git`, `.env`, `secrets`,
 * `node_modules`). Full glob patterns are a deliberate later addition, not a first cut.
 *
 * Checked against both the path as named and where it really is, so a link cannot reach a denied
 * place under another name, and a denied segment in the name itself still counts.
 * @param target The write target path from the tool input.
 * @param denyList The user's deny entries (absolute paths or path segments).
 * @param base The directory a relative target resolves against (the run's working directory).
 * @returns Returns true when the write is denied.
 */
export function isWriteDenied(target: string, denyList: readonly string[], base: string): boolean {
  if (denyList.length === 0) {
    return false;
  }
  const named: string = isAbsolute(target) ? resolve(target) : resolve(base, target);
  const candidates: readonly string[] = [...new Set<string>([named, realPathOf(named)])];
  const denied: boolean = candidates.some((resolvedTarget: string): boolean => {
    const segments: readonly string[] = resolvedTarget
      .split(sep)
      .filter((s: string): boolean => s.length > 0);
    return denyList.some((entry: string): boolean => {
      if (entry.length === 0) {
        return false;
      }
      if (isAbsolute(entry)) {
        const resolvedEntry: string = realPathOf(resolve(entry));
        return resolvedTarget === resolvedEntry || isWithin(resolvedTarget, resolvedEntry);
      }
      return segments.includes(entry);
    });
  });
  if (denied) {
    logger.debug('WriteConfinement', `Deny list blocks write to '${named}'`);
  }
  return denied;
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
    .filter(
      (entry: string): boolean => entry.length > 0 && (!requireAbsolute || isAbsolute(entry)),
    );
}

/**
 * Determines whether a resolved target path equals or sits beneath a resolved root, by `..`-normalised
 * containment of two paths that have already been taken to where they really are.
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
