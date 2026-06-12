import { computed, Service, signal, Signal, WritableSignal } from '@angular/core';
import {
  DirectoryEntry,
  DirectoryEntryType,
  DirectoryListing,
  OpenSelection,
  WorkspaceApi,
} from '../../../shared/studio-api';

/**
 * Represents a node in the renderer's lazy directory tree. Directories load their children on first
 * expansion; a null {@link children} means "not yet loaded", distinct from an empty array.
 */
export interface WorkspaceTreeNode {
  /**
   * Gets the entry's base name.
   */
  readonly name: string;

  /**
   * Gets the entry's absolute path; also the node's stable identity.
   */
  readonly path: string;

  /**
   * Gets whether the entry is a file or a directory.
   */
  readonly type: DirectoryEntryType;

  /**
   * Gets whether the directory is expanded. Always false for files.
   */
  readonly expanded: boolean;

  /**
   * Gets whether the directory's children are currently being loaded.
   */
  readonly loading: boolean;

  /**
   * Gets the loaded children, or null when they have not been loaded yet.
   */
  readonly children: readonly WorkspaceTreeNode[] | null;
}

/**
 * Represents a flattened, depth-tagged row used to render the visible tree.
 */
export interface WorkspaceTreeRow {
  /**
   * Gets the node rendered by this row.
   */
  readonly node: WorkspaceTreeNode;

  /**
   * Gets the node's depth beneath the workspace root (root children are depth 0).
   */
  readonly depth: number;
}

/**
 * Represents the renderer-side workspace state: the open root and its lazily-expanded directory
 * tree, exposed as signals. Wraps the Electron workspace bridge on `window.studio.workspace`; when
 * the application runs outside Electron the bridge is absent and every operation degrades to a safe
 * no-op so the UI renders its empty state instead of throwing.
 */
@Service()
export class Workspace {
  /**
   * Holds the workspace bridge, or undefined when running outside Electron.
   */
  private readonly api: WorkspaceApi | undefined = window.studio?.workspace;

  /**
   * Holds the open root listing, or null when no folder is open.
   */
  private readonly rootListing: WritableSignal<DirectoryListing | null> =
    signal<DirectoryListing | null>(null);

  /**
   * Holds the root's child nodes, the entry point of the lazy tree.
   */
  private readonly treeNodes: WritableSignal<readonly WorkspaceTreeNode[]> = signal<
    readonly WorkspaceTreeNode[]
  >([]);

  /**
   * Holds the absolute path of the selected entry, or null when nothing is selected.
   */
  private readonly selection: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Gets a value indicating whether a real workspace bridge is available (running in Electron).
   */
  public readonly isElectron: boolean = this.api !== undefined;

  /**
   * Gets the open root listing, or null when no folder is open.
   */
  public readonly root: Signal<DirectoryListing | null> = this.rootListing.asReadonly();

  /**
   * Gets a value indicating whether a folder is currently open.
   */
  public readonly hasWorkspace: Signal<boolean> = computed(
    (): boolean => this.rootListing() !== null,
  );

  /**
   * Gets the open root's base name, or an empty string when no folder is open.
   */
  public readonly rootName: Signal<string> = computed((): string => this.rootListing()?.name ?? '');

  /**
   * Gets the absolute path of the selected entry, or null when nothing is selected.
   */
  public readonly selectedPath: Signal<string | null> = this.selection.asReadonly();

  /**
   * Gets the visible tree flattened into depth-tagged rows for rendering.
   */
  public readonly rows: Signal<readonly WorkspaceTreeRow[]> = computed(
    (): readonly WorkspaceTreeRow[] => this.flatten(this.treeNodes(), 0),
  );

  /**
   * Shows an open-folder dialog and, when a folder is chosen, opens it as the workspace.
   * @returns Returns a promise that resolves once the folder has been opened (or the dialog cancelled).
   */
  public async openFolder(): Promise<void> {
    const listing: DirectoryListing | null = await (this.api?.openFolder() ??
      Promise.resolve(null));
    if (listing === null) {
      return;
    }
    this.setListing(listing);
  }

  /**
   * Shows the combined open dialog (file or folder). Routing the result into tabs or the workspace
   * is the caller's responsibility; this is a thin bridge to the main process.
   * @returns Returns the selection, or null when cancelled or running outside Electron.
   */
  public open(): Promise<OpenSelection | null> {
    return this.api?.open() ?? Promise.resolve(null);
  }

  /**
   * Reads a single file within the workspace for opening in an editor.
   * @param path The absolute path of the file to read.
   * @returns Returns the file selection (text or binary), or null when invalid or outside Electron.
   */
  public readFile(path: string): Promise<OpenSelection | null> {
    return this.api?.openFile(path) ?? Promise.resolve(null);
  }

  /**
   * Opens an already-obtained directory listing as the workspace, seeding the tree from it without
   * showing a dialog. Used when a folder was chosen through the combined open dialog.
   * @param listing The root directory listing to display.
   */
  public openListing(listing: DirectoryListing): void {
    this.setListing(listing);
  }

  /**
   * Closes the open folder, clearing the root, tree, and selection.
   * @returns Returns a promise that resolves once the folder has been closed.
   */
  public async closeFolder(): Promise<void> {
    const root: string | undefined = this.rootListing()?.path;
    if (root !== undefined) {
      await (this.api?.closeFolder(root) ?? Promise.resolve());
    }
    this.rootListing.set(null);
    this.treeNodes.set([]);
    this.selection.set(null);
  }

  /**
   * Selects an entry by path.
   * @param path The absolute path of the entry to select.
   */
  public select(path: string): void {
    this.selection.set(path);
  }

  /**
   * Toggles a directory's expansion, lazily loading its children the first time it is expanded.
   * @param path The absolute path of the directory to toggle.
   * @returns Returns a promise that resolves once the directory has been toggled (and loaded if needed).
   */
  public async toggleDirectory(path: string): Promise<void> {
    const node: WorkspaceTreeNode | null = this.find(this.treeNodes(), path);
    if (node?.type !== 'directory') {
      return;
    }
    if (node.expanded) {
      this.update(
        path,
        (current: WorkspaceTreeNode): WorkspaceTreeNode => ({ ...current, expanded: false }),
      );
      return;
    }
    if (node.children !== null) {
      this.update(
        path,
        (current: WorkspaceTreeNode): WorkspaceTreeNode => ({ ...current, expanded: true }),
      );
      return;
    }
    this.update(
      path,
      (current: WorkspaceTreeNode): WorkspaceTreeNode => ({ ...current, loading: true }),
    );
    const listing: DirectoryListing | null = await (this.api?.readDirectory(path) ??
      Promise.resolve(null));
    const children: readonly WorkspaceTreeNode[] =
      listing === null
        ? []
        : listing.entries.map((entry: DirectoryEntry): WorkspaceTreeNode => this.toNode(entry));
    this.update(
      path,
      (current: WorkspaceTreeNode): WorkspaceTreeNode => ({
        ...current,
        loading: false,
        expanded: true,
        children,
      }),
    );
  }

  /**
   * Replaces the open root listing and seeds the tree with its children.
   * @param listing The root directory listing.
   */
  private setListing(listing: DirectoryListing): void {
    this.rootListing.set(listing);
    this.treeNodes.set(
      listing.entries.map((entry: DirectoryEntry): WorkspaceTreeNode => this.toNode(entry)),
    );
    this.selection.set(null);
  }

  /**
   * Maps a directory entry to a collapsed, unloaded tree node.
   * @param entry The directory entry to wrap.
   * @returns Returns the new tree node.
   */
  private toNode(entry: DirectoryEntry): WorkspaceTreeNode {
    return {
      name: entry.name,
      path: entry.path,
      type: entry.type,
      expanded: false,
      loading: false,
      children: null,
    };
  }

  /**
   * Applies an immutable update to the node at the given path, replacing the tree signal.
   * @param path The absolute path of the node to update.
   * @param updater A function producing the replacement node.
   */
  private update(path: string, updater: (node: WorkspaceTreeNode) => WorkspaceTreeNode): void {
    this.treeNodes.update((nodes: readonly WorkspaceTreeNode[]): readonly WorkspaceTreeNode[] =>
      this.patch(nodes, path, updater),
    );
  }

  /**
   * Produces a new node list with the node at the given path replaced by the updater's result.
   * @param nodes The nodes to search.
   * @param path The absolute path of the node to replace.
   * @param updater A function producing the replacement node.
   * @returns Returns the new node list.
   */
  private patch(
    nodes: readonly WorkspaceTreeNode[],
    path: string,
    updater: (node: WorkspaceTreeNode) => WorkspaceTreeNode,
  ): readonly WorkspaceTreeNode[] {
    return nodes.map((node: WorkspaceTreeNode): WorkspaceTreeNode => {
      if (node.path === path) {
        return updater(node);
      }
      if (node.children !== null) {
        return { ...node, children: this.patch(node.children, path, updater) };
      }
      return node;
    });
  }

  /**
   * Finds the node with the given path anywhere in the tree.
   * @param nodes The nodes to search.
   * @param path The absolute path to find.
   * @returns Returns the matching node, or null when none is found.
   */
  private find(nodes: readonly WorkspaceTreeNode[], path: string): WorkspaceTreeNode | null {
    for (const node of nodes) {
      if (node.path === path) {
        return node;
      }
      if (node.children !== null) {
        const found: WorkspaceTreeNode | null = this.find(node.children, path);
        if (found !== null) {
          return found;
        }
      }
    }
    return null;
  }

  /**
   * Flattens the visible tree into depth-tagged rows, pruning collapsed and unloaded subtrees.
   * @param nodes The nodes to flatten.
   * @param depth The depth of these nodes beneath the root.
   * @returns Returns the flattened rows in render order.
   */
  private flatten(nodes: readonly WorkspaceTreeNode[], depth: number): readonly WorkspaceTreeRow[] {
    const rows: WorkspaceTreeRow[] = [];
    for (const node of nodes) {
      rows.push({ node, depth });
      if (node.type === 'directory' && node.expanded && node.children !== null) {
        rows.push(...this.flatten(node.children, depth + 1));
      }
    }
    return rows;
  }
}
