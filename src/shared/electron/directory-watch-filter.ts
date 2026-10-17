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
 * Describes, per version-control metadata directory name (`.git`, `.svn`), the patterns inside it whose
 * changes mean something a subscriber shows has changed: the checked-out commit moved, the stage
 * changed, a ref changed. Supplied by the installed version-control plugins (#817) — core names no
 * tool's layout. An empty list means every change inside counts.
 */
export type MetadataPolicies = ReadonlyMap<string, readonly string[]>;

/**
 * Determines whether a native tree-watch event should be forwarded to subscribers, given the changed
 * entry's path relative to the watched root. Changes inside an ignored directory are dropped, at any
 * depth and whichever ignored ancestor comes first; the ignored directory entry itself is kept so its
 * parent's listing stays live. Changes inside a version-control metadata directory are dropped unless
 * they match one of its plugin's signal patterns — a fetch or repack writes thousands of objects that
 * never change a rendered branch, status or history on their own.
 * @param relativePath The changed entry's path relative to the watched root, using either separator.
 * @param metadata The metadata directories and their signal patterns.
 * @returns Returns true when the event should be forwarded.
 */
export function shouldForwardTreeEvent(
  relativePath: string,
  metadata: MetadataPolicies = new Map<string, readonly string[]>(),
): boolean {
  const segments: string[] = relativePath.split(/[\\/]/);
  for (let index: number = 0; index < segments.length - 1; index++) {
    const segment: string = segments[index];
    const signals: readonly string[] | undefined = metadata.get(segment);
    if (signals !== undefined) {
      const inside: readonly string[] = segments.slice(index + 1);
      return (
        signals.length === 0 ||
        signals.some((pattern: string): boolean => matchesPattern(inside, pattern.split('/')))
      );
    }
    if (IGNORED_DIRECTORIES.has(segment.toLowerCase())) {
      return false;
    }
  }
  return true;
}

/**
 * Matches path segments against a pattern's segments: `**` matches any number of segments (including
 * none), and `*` within a segment matches any run of characters.
 * @param path The path segments.
 * @param pattern The pattern segments.
 * @returns Returns true when the path matches.
 */
function matchesPattern(path: readonly string[], pattern: readonly string[]): boolean {
  if (pattern.length === 0) {
    return path.length === 0;
  }
  const [head, ...rest]: readonly string[] = pattern;
  if (head === '**') {
    return (
      path.some((_: string, skip: number): boolean => matchesPattern(path.slice(skip), rest)) ||
      matchesPattern([], rest)
    );
  }
  return path.length > 0 && matchesSegment(path[0], head) && matchesPattern(path.slice(1), rest);
}

/**
 * Matches one path segment against one pattern segment, where `*` matches any run of characters.
 * @param segment The path segment.
 * @param pattern The pattern segment.
 * @returns Returns true when the segment matches.
 */
function matchesSegment(segment: string, pattern: string): boolean {
  const escaped: string = pattern
    .split('*')
    .map((part: string): string => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${escaped}$`).test(segment);
}
