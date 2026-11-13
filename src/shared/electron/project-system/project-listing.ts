import { Dirent } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { ProjectItemNode } from '@shared/api/project-system';

/**
 * Says what a project system's listing keeps (#899). Each ecosystem names its own output and cache
 * folders, its own source files and its own way of marking a separate project; the walk itself — the
 * reading, the order, the file budget, the empty folders dropped — is the same for all of them.
 */
export interface ProjectListingRules {
  /**
   * Determines whether a subdirectory is skipped by name: an output, cache or dependency folder.
   * @param name The directory's name.
   * @returns Returns true when the directory and everything under it is left out.
   */
  readonly skipDirectory: (name: string) => boolean;

  /**
   * Determines whether a file is listed. Absent, every file is: a declared source folder holds what
   * the build declared, resources included. A fallback listing passes the ecosystem's source filter,
   * so an output folder the skip list does not name can never crowd the sources out of the budget.
   * @param name The file's name.
   * @returns Returns true when the file is listed.
   */
  readonly keepFile?: (name: string) => boolean;

  /**
   * Determines whether a subdirectory is another project, whose contents belong to its own node — a
   * nested `package.json` or build manifest. Absent, none is.
   * @param directory The subdirectory's absolute path.
   * @param depth How deep the directory being listed is: 0 for the folder the listing started at.
   * @returns Returns true when the subdirectory is left out.
   */
  readonly isSeparate?: (directory: string, depth: number) => Promise<boolean>;
}

/**
 * Lists a project's files as item nodes, recursing into subdirectories (#899). Folders come first and
 * then files, each sorted by name; a folder with nothing kept in it is dropped; and files stop being
 * added once the budget, shared across the whole walk, is spent — though the folders already reached
 * are still walked, so the tree stays a tree of what was listed.
 * @param directory The directory to list.
 * @param budget The remaining file budget, decremented as files are added.
 * @param rules What the ecosystem keeps.
 * @param depth How deep this directory is below where the listing started.
 * @returns Returns the nodes, or null when the directory cannot be read.
 */
export async function listProjectFiles(
  directory: string,
  budget: { remaining: number },
  rules: ProjectListingRules,
  depth: number = 0,
): Promise<readonly ProjectItemNode[] | null> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch {
    return null;
  }
  const byName: (a: Dirent, b: Dirent) => number = (a: Dirent, b: Dirent): number =>
    a.name.localeCompare(b.name);
  const directories: Dirent[] = entries
    .filter((entry: Dirent): boolean => entry.isDirectory() && !rules.skipDirectory(entry.name))
    .sort(byName);
  const files: Dirent[] = entries
    .filter(
      (entry: Dirent): boolean =>
        entry.isFile() && (rules.keepFile === undefined || rules.keepFile(entry.name)),
    )
    .sort(byName);
  const nodes: ProjectItemNode[] = [];
  for (const child of directories) {
    const full: string = path.join(directory, child.name);
    if (rules.isSeparate !== undefined && (await rules.isSeparate(full, depth))) {
      continue;
    }
    const children: readonly ProjectItemNode[] | null = await listProjectFiles(
      full,
      budget,
      rules,
      depth + 1,
    );
    if (children !== null && children.length > 0) {
      nodes.push({ type: 'folder', name: child.name, path: full, children });
    }
  }
  for (const file of files) {
    if (budget.remaining <= 0) {
      break;
    }
    budget.remaining -= 1;
    nodes.push({ type: 'file', name: file.name, path: path.join(directory, file.name) });
  }
  return nodes;
}

/**
 * Builds a source filter for a fallback listing: a file is kept when its extension is one of the
 * ecosystem's source extensions or its name is one of the ecosystem's manifests and lockfiles.
 * @param extensions The source extensions, lower case, with their dots (`.go`).
 * @param names The exact file names kept whatever their extension (`go.mod`).
 * @returns Returns the filter.
 */
export function sourceFilter(
  extensions: readonly string[],
  names: readonly string[],
): (name: string) => boolean {
  const kept: ReadonlySet<string> = new Set(extensions);
  const named: ReadonlySet<string> = new Set(names);
  return (name: string): boolean => named.has(name) || kept.has(path.extname(name).toLowerCase());
}
