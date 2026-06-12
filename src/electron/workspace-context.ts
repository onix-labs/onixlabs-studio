import * as path from 'node:path';

/**
 * Holds the absolute path of the currently-open workspace root and decides whether a given path is
 * confined to it. Shared between the workspace IPC handler and any future handlers (such as git) so
 * they all confine their operations to the same folder, treating the renderer as hostile.
 */
export class WorkspaceContext {
  /**
   * Holds the absolute workspace root path, or null when no folder is open.
   */
  private root: string | null = null;

  /**
   * Gets the current workspace root.
   * @returns Returns the absolute root path, or null when no folder is open.
   */
  public getRoot(): string | null {
    return this.root;
  }

  /**
   * Sets the current workspace root.
   * @param root The absolute root path, or null to clear it.
   */
  public setRoot(root: string | null): void {
    this.root = root === null ? null : path.resolve(root);
  }

  /**
   * Determines whether a path resolves to a location inside the open workspace root. A path is
   * confined when it is the root itself or a descendant of it; everything else (including non-string
   * input, empty strings, and `..` traversal that escapes the root) is rejected.
   * @param target The path to test.
   * @returns Returns true when the path is the workspace root or a descendant of it.
   */
  public isWithin(target: unknown): boolean {
    if (this.root === null || typeof target !== 'string' || target.length === 0) {
      return false;
    }
    const resolved: string = path.resolve(target);
    return resolved === this.root || resolved.startsWith(this.root + path.sep);
  }
}
