// Finds the crates in a folder and the workspace each belongs to.
//
// Two routes, joined: a bounded walk of the folder for `Cargo.toml`, and each workspace's own
// `members` (globs and all), so a member deeper than the walk still appears. A workspace's members
// share its `Cargo.lock` and inherit its `[workspace.dependencies]`; a crate no workspace claims stands
// alone, with its own lockfile beside it.

import { Dirent, promises as fs } from 'node:fs';
import * as path from 'node:path';
import { CargoManifest, readManifest } from './cargo-manifest';
import { note } from './log';
import { parseToml } from './toml';

/**
 * The manifest's file name.
 */
export const MANIFEST: string = 'Cargo.toml';

/**
 * How many directory levels the walk descends (1 reads only the folder itself).
 */
const SCAN_DEPTH: number = 6;

/**
 * The directories the walk never enters: build output and other ecosystems' dependencies hold no crate
 * of the user's.
 */
const SKIPPED: ReadonlySet<string> = new Set<string>(['target', 'node_modules']);

/**
 * One manifest found in the folder.
 */
export interface FoundManifest {
  /**
   * Gets the manifest's absolute path.
   */
  readonly manifestPath: string;

  /**
   * Gets the manifest, read.
   */
  readonly manifest: CargoManifest;

  /**
   * Gets the absolute path of the workspace manifest it belongs to: its own when it is a workspace
   * root, null when it stands alone.
   */
  readonly workspacePath: string | null;
}

/**
 * Finds every manifest in a folder, each with its workspace. Unreadable or malformed manifests are left
 * out, noted in the log.
 * @param root The absolute folder.
 * @returns Returns the manifests, sorted by path.
 */
export async function findManifests(root: string): Promise<readonly FoundManifest[]> {
  const manifests: Map<string, CargoManifest> = new Map<string, CargoManifest>();
  for (const file of await walk(root, SCAN_DEPTH)) {
    const manifest: CargoManifest | null = await readManifestFile(file);
    if (manifest !== null) {
      manifests.set(file, manifest);
    }
  }

  const membership: Map<string, string> = new Map<string, string>();
  for (const [workspacePath, manifest] of [...manifests.entries()]) {
    if (manifest.workspace === null) {
      continue;
    }
    const directory: string = path.dirname(workspacePath);
    if (manifest.name !== null) {
      membership.set(workspacePath, workspacePath);
    }
    const excluded: readonly string[] = manifest.workspace.exclude.map((entry: string): string =>
      path.resolve(directory, entry),
    );
    for (const pattern of manifest.workspace.members) {
      for (const member of await expandMember(directory, pattern)) {
        const memberPath: string = path.join(member, MANIFEST);
        if (!isInside(memberPath, root) || isExcluded(member, excluded)) {
          continue;
        }
        if (!manifests.has(memberPath)) {
          const read: CargoManifest | null = await readManifestFile(memberPath);
          if (read === null) {
            continue;
          }
          manifests.set(memberPath, read);
        }
        if (!membership.has(memberPath)) {
          membership.set(memberPath, workspacePath);
        }
      }
    }
  }

  // A crate can name its workspace explicitly when the workspace is not an ancestor.
  for (const [manifestPath, manifest] of manifests) {
    if (membership.has(manifestPath) || manifest.workspacePath === null) {
      continue;
    }
    const named: string = path.join(
      path.resolve(path.dirname(manifestPath), manifest.workspacePath),
      MANIFEST,
    );
    if ((manifests.get(named)?.workspace ?? null) !== null) {
      membership.set(manifestPath, named);
    }
  }

  return [...manifests.entries()]
    .map(([manifestPath, manifest]: [string, CargoManifest]): FoundManifest => ({
      manifestPath,
      manifest,
      workspacePath: membership.get(manifestPath) ?? null,
    }))
    .sort((a: FoundManifest, b: FoundManifest): number =>
      a.manifestPath.localeCompare(b.manifestPath),
    );
}

/**
 * Reads and parses one manifest.
 * @param file The absolute path.
 * @returns Returns the manifest, or null when it is absent or cannot be read.
 */
export async function readManifestFile(file: string): Promise<CargoManifest | null> {
  let text: string;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch {
    return null;
  }
  try {
    return readManifest(parseToml(text));
  } catch (error: unknown) {
    note('cargo', `Skipped a Cargo.toml that could not be read: ${(error as Error).message}`);
    return null;
  }
}

/**
 * Expands one `members` entry into the directories it names. `*` and `?` match within one path
 * segment, and `**` matches any number of them, as cargo's globs do. Only directories holding a
 * `Cargo.toml` are members.
 * @param directory The workspace's directory.
 * @param pattern The entry.
 * @returns Returns the member directories.
 */
export async function expandMember(directory: string, pattern: string): Promise<readonly string[]> {
  const segments: readonly string[] = pattern
    .split(/[\\/]+/)
    .filter((segment: string): boolean => segment.length > 0 && segment !== '.');
  const found: string[] = [];
  await expandSegments(directory, segments, found);
  const members: string[] = [];
  for (const candidate of new Set<string>(found)) {
    if (await isFile(path.join(candidate, MANIFEST))) {
      members.push(candidate);
    }
  }
  return members;
}

/**
 * Expands the remaining segments of a member glob from one directory.
 * @param directory The directory reached so far.
 * @param segments The segments still to match.
 * @param found Receives the directories every segment matched.
 */
async function expandSegments(
  directory: string,
  segments: readonly string[],
  found: string[],
): Promise<void> {
  if (segments.length === 0) {
    found.push(directory);
    return;
  }
  const [segment, ...rest] = segments;
  if (segment === '**') {
    await expandSegments(directory, rest, found);
    for (const child of await childDirectories(directory)) {
      await expandSegments(child, segments, found);
    }
    return;
  }
  if (!/[*?[]/.test(segment)) {
    await expandSegments(path.resolve(directory, segment), rest, found);
    return;
  }
  const matcher: RegExp = globSegment(segment);
  for (const child of await childDirectories(directory)) {
    if (matcher.test(path.basename(child))) {
      await expandSegments(child, rest, found);
    }
  }
}

/**
 * Turns one glob segment into a pattern for a directory name.
 * @param segment The segment.
 * @returns Returns the pattern.
 */
function globSegment(segment: string): RegExp {
  let source: string = '';
  for (const character of segment) {
    if (character === '*') {
      source += '[^/]*';
    } else if (character === '?') {
      source += '[^/]';
    } else {
      source += character.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${source}$`);
}

/**
 * Lists a directory's visible subdirectories, skipping build output.
 * @param directory The directory.
 * @returns Returns their absolute paths.
 */
async function childDirectories(directory: string): Promise<readonly string[]> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter(
      (entry: Dirent): boolean =>
        entry.isDirectory() && !entry.name.startsWith('.') && !SKIPPED.has(entry.name),
    )
    .map((entry: Dirent): string => path.join(directory, entry.name));
}

/**
 * Walks a folder for manifests, at most `depth` levels down.
 * @param directory The folder.
 * @param depth The levels left (1 reads only this folder).
 * @returns Returns the manifests' absolute paths.
 */
async function walk(directory: string, depth: number): Promise<readonly string[]> {
  const results: string[] = [];
  if (await isFile(path.join(directory, MANIFEST))) {
    results.push(path.join(directory, MANIFEST));
  }
  if (depth > 1) {
    for (const child of await childDirectories(directory)) {
      results.push(...(await walk(child, depth - 1)));
    }
  }
  return results;
}

/**
 * Determines whether a path is a file.
 * @param file The path.
 * @returns Returns true for a file.
 */
async function isFile(file: string): Promise<boolean> {
  try {
    return (await fs.stat(file)).isFile();
  } catch {
    return false;
  }
}

/**
 * Determines whether a member directory is excluded: it is, or lies under, an `exclude` entry.
 * @param member The member directory.
 * @param excluded The excluded directories.
 * @returns Returns true when it is excluded.
 */
function isExcluded(member: string, excluded: readonly string[]): boolean {
  return excluded.some(
    (entry: string): boolean => member === entry || member.startsWith(entry + path.sep),
  );
}

/**
 * Determines whether a path lies within a folder.
 * @param target The path.
 * @param root The folder.
 * @returns Returns true when it does.
 */
export function isInside(target: string, root: string): boolean {
  const resolved: string = path.resolve(target);
  const folder: string = path.resolve(root);
  return resolved === folder || resolved.startsWith(folder + path.sep);
}
