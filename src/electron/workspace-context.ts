import * as path from 'node:path';

/**
 * Tracks the set of open workspace roots and decides whether a given path is confined to one of
 * them. The application can open several workspaces at once (one per directory tab); a filesystem
 * operation is allowed when its path lies within any open root. Shared by the workspace IPC handler
 * (and any future handlers) so they all confine operations to the opened folders, treating the
 * renderer as hostile.
 */
export class WorkspaceContext {
  /**
   * Holds the absolute paths of every open workspace root.
   */
  private readonly roots: Set<string> = new Set<string>();

  /**
   * Adds a workspace root.
   * @param root The absolute root path.
   */
  public addRoot(root: string): void {
    this.roots.add(path.resolve(root));
  }

  /**
   * Removes a workspace root, closing that workspace.
   * @param root The absolute root path to remove.
   */
  public removeRoot(root: string): void {
    this.roots.delete(path.resolve(root));
  }

  /**
   * Determines whether a path resolves to exactly one of the open workspace roots.
   * @param target The path to test.
   * @returns Returns true when the path is an open workspace root.
   */
  public isRoot(target: string): boolean {
    return this.roots.has(path.resolve(target));
  }

  /**
   * Determines whether a path resolves to a location inside any open workspace root. A path is
   * confined when it is a root itself or a descendant of one; everything else (including non-string
   * input, empty strings, and `..` traversal that escapes every root) is rejected.
   * @param target The path to test.
   * @returns Returns true when the path is within an open workspace root.
   */
  public isWithin(target: unknown): boolean {
    if (typeof target !== 'string' || target.length === 0) {
      return false;
    }
    const resolved: string = path.resolve(target);
    for (const root of this.roots) {
      if (resolved === root || resolved.startsWith(root + path.sep)) {
        return true;
      }
    }
    return false;
  }
}
