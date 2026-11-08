import { promises as fs } from 'node:fs';
import * as path from 'node:path';

// Which marker files a folder holds, for deciding which test adapters apply to it (#1351). The same walk
// the package-manager host makes (#908), kept separate for now so the two seams can change apart; one
// shared scan is a follow-up once both have settled.

/**
 * Specifies how many levels below a folder the scan looks. A project sits at or near the root of what
 * is open; deeper than this the walk costs more than it finds.
 */
const MARKER_SCAN_DEPTH: number = 3;

/**
 * Specifies how many directories one scan reads, so a huge unignored tree costs a bounded walk.
 */
const MARKER_SCAN_DIRECTORIES: number = 2_000;

/**
 * Specifies the directories the scan never enters: what tools generate, where a marker found would be a
 * dependency's and not a project of the user's. Hidden directories are skipped as well.
 */
const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set<string>([
  'node_modules',
  'bin',
  'obj',
  'dist',
  'build',
  'out',
  'target',
  'vendor',
]);

/**
 * Describes one entry the scan sees in a directory.
 */
export interface DirectoryEntry {
  /**
   * Gets the entry's name.
   */
  readonly name: string;

  /**
   * Gets whether the entry is a directory.
   */
  readonly directory: boolean;
}

/**
 * Turns a marker into a pattern for one file name: `*` matches within the name, and everything else
 * stands for itself.
 * @param marker The marker.
 * @returns Returns the pattern.
 */
export function markerPattern(marker: string): RegExp {
  const parts: readonly string[] = marker
    .split('*')
    .map((part: string): string => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`^${parts.join('.*')}$`);
}

/**
 * Walks a folder once and answers, for any marker, whether a file it names lies within the scan.
 * @param root The absolute folder.
 * @param markers The markers that will be asked about, so the walk can stop once each is found.
 * @param list Lists a directory; defaults to the filesystem.
 * @returns Returns the test for one marker.
 */
export async function folderHoldsMarker(
  root: string,
  markers: readonly string[],
  list: (directory: string) => Promise<readonly DirectoryEntry[]> = listDirectory,
): Promise<(marker: string) => boolean> {
  const patterns: ReadonlyMap<string, RegExp> = new Map<string, RegExp>(
    markers.map((marker: string): [string, RegExp] => [marker, markerPattern(marker)]),
  );
  const found: Set<string> = new Set<string>();
  let level: readonly string[] = [root];
  let read: number = 0;
  for (
    let depth: number = 0;
    depth <= MARKER_SCAN_DEPTH && level.length > 0 && found.size < patterns.size;
    depth += 1
  ) {
    const next: string[] = [];
    for (const directory of level) {
      if (read >= MARKER_SCAN_DIRECTORIES) {
        break;
      }
      read += 1;
      for (const entry of await list(directory)) {
        if (!entry.directory) {
          for (const [marker, pattern] of patterns) {
            if (!found.has(marker) && pattern.test(entry.name)) {
              found.add(marker);
            }
          }
        } else if (!entry.name.startsWith('.') && !SKIPPED_DIRECTORIES.has(entry.name)) {
          next.push(path.join(directory, entry.name));
        }
      }
    }
    level = next;
  }
  return (marker: string): boolean => found.has(marker);
}

/**
 * Lists a directory, tolerating one that cannot be read.
 * @param directory The directory.
 * @returns Returns its entries, or none when it cannot be read.
 */
async function listDirectory(directory: string): Promise<readonly DirectoryEntry[]> {
  try {
    const entries: import('node:fs').Dirent[] = await fs.readdir(directory, {
      withFileTypes: true,
    });
    return entries.map((entry: import('node:fs').Dirent): DirectoryEntry => ({
      name: entry.name,
      directory: entry.isDirectory(),
    }));
  } catch {
    return [];
  }
}
