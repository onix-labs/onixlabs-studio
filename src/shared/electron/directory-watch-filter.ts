/**
 * Decides which native tree-watch events are worth telling the renderer about. Build outputs and
 * dependency caches (`bin`, `obj`, `.vs`, `node_modules`) produce thousands of events during a build
 * or restore; forwarding them floods every subscriber of the root — the explorers re-read their
 * loaded directories, the source-control views re-run git status, and the Solution Explorer
 * re-evaluates the whole solution — and a large enough burst collapses the coalescing window into an
 * "overflow", telling all of them to refresh everything at once. Dropping those events here, before
 * they enter the coalescing window, is the single choke point that keeps a build from becoming an
 * application-wide refresh storm. Pure module, so the policy is unit-testable without Electron.
 */

/**
 * Names the directories whose contents are dropped: build outputs and dependency caches whose
 * internal churn never changes what any subscriber shows. Compared case-insensitively, since the
 * common filesystems are case-insensitive and MSBuild's output casing varies. The directory entry
 * itself is still forwarded (see {@link shouldForwardTreeEvent}), so an explorer showing a project
 * folder still sees `bin` appear and disappear.
 */
const IGNORED_DIRECTORIES: ReadonlySet<string> = new Set<string>([
  'node_modules',
  'bin',
  'obj',
  '.vs',
]);

/**
 * Names the `.git` entries that signal something a subscriber shows: the checked-out commit moved
 * (`HEAD`, and operation heads such as `MERGE_HEAD` or `REBASE_HEAD`), the stage changed (`index`),
 * or refs changed (`packed-refs`, with `refs/**` matched separately). Everything else inside `.git`
 * — `objects`, `logs`, temporary lock files — is churn from git's own bookkeeping: it fires in huge
 * bursts during fetches and repacks and never changes a rendered branch, status, or history view on
 * its own.
 */
const GIT_SIGNAL_ENTRIES: ReadonlySet<string> = new Set<string>(['HEAD', 'index', 'packed-refs']);

/**
 * Determines whether a native tree-watch event should be forwarded to subscribers, given the changed
 * entry's path relative to the watched root. Changes inside an ignored directory are dropped, at any
 * depth and whichever ignored ancestor comes first; the ignored directory entry itself is kept so its
 * parent's listing stays live. Changes inside a `.git` directory are dropped unless they touch one of
 * the few entries that signal a branch, stage, or ref change.
 * @param relativePath The changed entry's path relative to the watched root, using either separator.
 * @returns Returns true when the event should be forwarded.
 */
export function shouldForwardTreeEvent(relativePath: string): boolean {
  const segments: string[] = relativePath.split(/[\\/]/);
  for (let index: number = 0; index < segments.length - 1; index++) {
    const segment: string = segments[index];
    if (segment === '.git') {
      return isGitSignal(segments.slice(index + 1));
    }
    if (IGNORED_DIRECTORIES.has(segment.toLowerCase())) {
      return false;
    }
  }
  return true;
}

/**
 * Determines whether a path inside a `.git` directory is one of the entries that signal a change
 * subscribers care about: a head file, the index, packed refs, or anything under `refs/`.
 * @param segments The path segments after the `.git` segment (never empty).
 * @returns Returns true when the entry signals a branch, stage, or ref change.
 */
function isGitSignal(segments: readonly string[]): boolean {
  if (segments[0] === 'refs') {
    return true;
  }
  if (segments.length > 1) {
    return false;
  }
  const entry: string = segments[0];
  return GIT_SIGNAL_ENTRIES.has(entry) || entry.endsWith('_HEAD');
}
