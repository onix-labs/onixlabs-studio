// Finding and reading a folder's build files.

import { Dirent, promises as fs } from 'node:fs';
import * as path from 'node:path';

/**
 * The directories never searched: build output (`target` for Maven, `build` for Gradle) and other
 * ecosystems' dependencies hold copies of build files, not projects.
 */
const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set<string>([
  'node_modules',
  'target',
  'build',
]);

/**
 * How deep a folder is searched for build files (1 searches the folder itself): deep enough for the
 * usual `services/orders/api/pom.xml`, bounded so a large tree cannot run away.
 */
export const SCAN_DEPTH: number = 6;

/**
 * Finds the files under a folder whose names a predicate accepts, skipping hidden directories and
 * build output.
 * @param directory The folder.
 * @param accept Decides whether a file name is wanted.
 * @param depth How many levels to descend (1 searches only the folder).
 * @returns Returns the files' absolute paths, shallowest first and then by path, so the root build
 * leads and the panel's order is stable.
 */
export async function findFiles(
  directory: string,
  accept: (name: string) => boolean,
  depth: number = SCAN_DEPTH,
): Promise<readonly string[]> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  const found: string[] = [];
  for (const entry of entries) {
    const full: string = path.join(directory, entry.name);
    if (entry.isFile() && accept(entry.name)) {
      found.push(full);
    } else if (
      entry.isDirectory() &&
      depth > 1 &&
      !entry.name.startsWith('.') &&
      !SKIPPED_DIRECTORIES.has(entry.name)
    ) {
      found.push(...(await findFiles(full, accept, depth - 1)));
    }
  }
  return found.sort(
    (a: string, b: string): number =>
      a.split(path.sep).length - b.split(path.sep).length || (a < b ? -1 : a > b ? 1 : 0),
  );
}

/**
 * Reads a text file.
 * @param filePath The absolute path.
 * @returns Returns its text, or null when it is absent or unreadable.
 */
export async function readText(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Determines whether a file exists.
 * @param filePath The absolute path.
 * @returns Returns true when it is a file.
 */
export async function isFile(filePath: string): Promise<boolean> {
  try {
    return (await fs.stat(filePath)).isFile();
  } catch {
    return false;
  }
}

/**
 * Determines whether a path lies within a folder (or is the folder).
 * @param candidate The absolute path.
 * @param root The absolute folder.
 * @returns Returns true when it is inside.
 */
export function isWithin(candidate: string, root: string): boolean {
  const relative: string = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
