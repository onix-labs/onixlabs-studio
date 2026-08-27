import * as path from 'node:path';
import { ProjectItemNode } from '@shared/api/project-system';

/**
 * A project item as evaluated from its project file: the item's own path relative to the project, and
 * the logical location `Link` metadata places it at (empty when it has none).
 */
export interface EvaluatedItem {
  /**
   * Gets the item's path relative to the project directory.
   */
  readonly identity: string;

  /**
   * Gets the logical location the item is placed at, or an empty string when it is placed by identity.
   */
  readonly link: string;
}

/**
 * A mutable folder used while assembling a project's contents tree: named sub-folders and named files
 * (mapped to their absolute paths), materialised into the immutable tree once all items are placed.
 */
interface ItemFolder {
  /**
   * Holds the named sub-folders.
   */
  readonly folders: Map<string, ItemFolder>;

  /**
   * Holds the named files, mapped to their absolute paths.
   */
  readonly files: Map<string, string>;

  /**
   * Holds the absolute directory the folder stands for, or null while it stands for none.
   *
   * Mutable, and written only by a placement that came from an item's own identity — a real relative
   * path under the project, whose parent directories therefore exist. A placement that came from `Link`
   * metadata leaves it alone: the link names a *logical* location that need not be a directory. Real
   * wins over linked, in either order, so a folder holding both a real file and a linked one still
   * reports the directory it genuinely has.
   */
  path: string | null;
}

/**
 * Builds a project's logical contents tree from its items: each item is placed by its link (when set)
 * or its identity, so linked files appear at their logical location while still opening their real
 * file. Items that resolve outside the project directory are placed at the root by their file name.
 *
 * Lives apart from the .NET project system that calls it so it can be tested without loading that file
 * — and its `execFile`/`fs` import graph — into the coverage denominator.
 * @param projectPath The absolute path of the project file.
 * @param items The evaluated items.
 * @returns Returns the contents tree.
 */
export function buildItemTree(
  projectPath: string,
  items: readonly EvaluatedItem[],
): readonly ProjectItemNode[] {
  const directory: string = path.dirname(projectPath);
  const root: ItemFolder = {
    folders: new Map<string, ItemFolder>(),
    files: new Map<string, string>(),
    path: directory,
  };
  const seen: Set<string> = new Set<string>();
  for (const item of items) {
    const logical: string = (item.link.length > 0 ? item.link : item.identity).replace(/\\/g, '/');
    if (seen.has(logical)) {
      continue;
    }
    seen.add(logical);
    const segments: string[] = logical
      .split('/')
      .filter((segment: string): boolean => segment.length > 0);
    // A path that climbs out of the project (a linked file with no Link metadata) is shown at the root.
    const placement: string[] = logical.startsWith('../') ? segments.slice(-1) : segments;
    const absolute: string = path.resolve(directory, item.identity.replace(/\\/g, '/'));
    // Only a placement by the item's own identity walks real directories; one placed by Link metadata
    // names a logical location that need not exist, so it is given no directory to build paths from.
    const placed: string | null =
      item.link.length > 0 || logical.startsWith('../') ? null : directory;
    insertItem(root, placement, absolute, placed);
  }
  return materialise(root);
}

/**
 * Inserts a file into the mutable folder structure under its path segments, creating folders as
 * needed.
 * @param folder The folder to insert into.
 * @param segments The file's path segments (the last is the file name).
 * @param absolute The file's absolute path.
 * @param directory The real directory the folder stands for, or null when it stands for none — a
 * linked placement passes null, and null descends to every folder created beneath it.
 */
function insertItem(
  folder: ItemFolder,
  segments: readonly string[],
  absolute: string,
  directory: string | null,
): void {
  if (segments.length <= 1) {
    folder.files.set(segments[0] ?? path.basename(absolute), absolute);
    return;
  }
  const [head, ...rest]: readonly string[] = segments;
  let child: ItemFolder | undefined = folder.folders.get(head);
  if (child === undefined) {
    child = {
      folders: new Map<string, ItemFolder>(),
      files: new Map<string, string>(),
      path: null,
    };
    folder.folders.set(head, child);
  }
  const descendant: string | null = directory === null ? null : path.join(directory, head);
  // Real wins over linked, in either order: a directory once known is never unset by a later linked
  // placement, and a linked placement never invents one.
  child.path ??= descendant;
  insertItem(child, rest, absolute, descendant);
}

/**
 * Converts the mutable folder structure into a sorted contents tree, folders before files and each
 * alphabetical.
 * @param folder The folder to convert.
 * @returns Returns the folder's children as tree nodes.
 */
function materialise(folder: ItemFolder): readonly ProjectItemNode[] {
  const folders: ProjectItemNode[] = [...folder.folders.entries()]
    .sort((a: [string, ItemFolder], b: [string, ItemFolder]): number => a[0].localeCompare(b[0]))
    .map(
      ([name, child]: [string, ItemFolder]): ProjectItemNode => ({
        type: 'folder',
        name,
        path: child.path,
        children: materialise(child),
      }),
    );
  const files: ProjectItemNode[] = [...folder.files.entries()]
    .sort((a: [string, string], b: [string, string]): number => a[0].localeCompare(b[0]))
    .map(
      ([name, filePath]: [string, string]): ProjectItemNode => ({
        type: 'file',
        name,
        path: filePath,
      }),
    );
  return [...folders, ...files];
}
