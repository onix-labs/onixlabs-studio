import { computed, inject, Service, signal, Signal, WritableSignal } from '@angular/core';
import { Bridge } from '@shared/api/bridge';
import {
  BinaryChunk,
  DirectoryEntry,
  DirectoryEntryType,
  DirectoryListing,
  OpenSelection,
  WorkspaceChannel,
} from '@shared/api/workspace-channels';
import { Settings } from '@shared/angular/services/settings/settings';

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

  /**
   * Gets whether the row renders as expanded (a directory with a down caret). In normal browsing this
   * mirrors the node's own state; while filtering it is forced true for a directory kept because a
   * descendant matched, so the match shows.
   */
  readonly expanded: boolean;
}

/**
 * Represents the renderer-side workspace state: the open root and its lazily-expanded directory
 * tree, exposed as signals. Drives the workspace IPC channels over the generic {@link Bridge}
 * transport (`window.bridge`); when the application runs outside Electron the bridge is absent and
 * every operation degrades to a safe no-op so the UI renders its empty state instead of throwing.
 */
@Service()
export class Workspace {
  /**
   * Holds the generic transport, or undefined when running outside Electron.
   */
  private readonly bridge: Bridge | undefined = window.bridge;

  /**
   * Holds the settings service, consulted for how "Expand All" should behave.
   */
  private readonly settings: Settings = inject(Settings);

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
   * Holds the active search query. While non-empty the tree is filtered to the loaded entries whose
   * name contains it (and their ancestors), with the matching branches force-expanded.
   */
  private readonly searchQuery: WritableSignal<string> = signal<string>('');

  /**
   * Gets a value indicating whether a real workspace bridge is available (running in Electron).
   */
  public readonly isElectron: boolean = this.bridge !== undefined;

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
   * Gets the active search query, exposed so the panel can highlight the matched text.
   */
  public readonly query: Signal<string> = this.searchQuery.asReadonly();

  /**
   * Gets the visible tree flattened into depth-tagged rows for rendering. While a search query is
   * active the rows are filtered to the matches (and their ancestors), with matching branches expanded.
   */
  public readonly rows: Signal<readonly WorkspaceTreeRow[]> = computed(
    (): readonly WorkspaceTreeRow[] => {
      const query: string = this.searchQuery().trim().toLowerCase();
      return query.length > 0
        ? this.filteredRows(this.treeNodes(), 0, query)
        : this.flatten(this.treeNodes(), 0);
    },
  );

  /**
   * Shows an open-folder dialog and, when a folder is chosen, opens it as the workspace.
   * @returns Returns a promise that resolves once the folder has been opened (or the dialog cancelled).
   */
  public async openFolder(): Promise<void> {
    const listing: DirectoryListing | null = await (this.bridge?.invoke<DirectoryListing | null>(
      WorkspaceChannel.OpenFolder,
    ) ?? Promise.resolve(null));
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
    return (
      this.bridge?.invoke<OpenSelection | null>(WorkspaceChannel.Open) ?? Promise.resolve(null)
    );
  }

  /**
   * Reads a single file within the workspace for opening in an editor.
   * @param path The absolute path of the file to read.
   * @returns Returns the file selection (text or binary), or null when invalid or outside Electron.
   */
  public readFile(path: string): Promise<OpenSelection | null> {
    return (
      this.bridge?.invoke<OpenSelection | null>(WorkspaceChannel.OpenFile, path) ??
      Promise.resolve(null)
    );
  }

  /**
   * Reads a window of raw bytes from a file for the binary/hex editor. The main process clamps the
   * window to the file and bounds its size, and returns the total file size so the caller can size its
   * virtual scroll without loading the whole file.
   * @param path The absolute path of the file to read.
   * @param offset The absolute byte offset to start reading from.
   * @param length The number of bytes to read.
   * @returns Returns the byte window and total size, or null when invalid, untrusted, or outside Electron.
   */
  public readBytes(path: string, offset: number, length: number): Promise<BinaryChunk | null> {
    return (
      this.bridge?.invoke<BinaryChunk | null>(WorkspaceChannel.ReadBytes, path, offset, length) ??
      Promise.resolve(null)
    );
  }

  /**
   * Reads a directory's listing by path, without showing a dialog or opening it as this workspace.
   * Used to open an arbitrary folder (for example a repository's root) as a new workspace tab.
   * @param path The absolute directory path to read.
   * @returns Returns the listing, or null when invalid or running outside Electron.
   */
  public readDirectoryListing(path: string): Promise<DirectoryListing | null> {
    return (
      this.bridge?.invoke<DirectoryListing | null>(WorkspaceChannel.ReadDirectory, path) ??
      Promise.resolve(null)
    );
  }

  /**
   * Re-opens a previously user-opened folder by path as a new workspace. The main process honours this
   * only for folders the user has opened through a dialog before, so an arbitrary path cannot be
   * registered as a workspace root.
   * @param path The absolute folder path to re-open.
   * @returns Returns the root listing, or null when not trusted, unreadable, or outside Electron.
   */
  public reopenFolder(path: string): Promise<DirectoryListing | null> {
    return (
      this.bridge?.invoke<DirectoryListing | null>(WorkspaceChannel.ReopenFolder, path) ??
      Promise.resolve(null)
    );
  }

  /**
   * Re-opens a previously user-opened file by path. The main process honours this only for files the
   * user has opened before or files within an open workspace, so an arbitrary file cannot be read.
   * @param path The absolute file path to re-open.
   * @returns Returns the file selection, or null when not trusted, unreadable, or outside Electron.
   */
  public reopenFile(path: string): Promise<OpenSelection | null> {
    return (
      this.bridge?.invoke<OpenSelection | null>(WorkspaceChannel.ReopenFile, path) ??
      Promise.resolve(null)
    );
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
      await (this.bridge?.invoke<void>(WorkspaceChannel.CloseFolder, root) ?? Promise.resolve());
    }
    this.rootListing.set(null);
    this.treeNodes.set([]);
    this.selection.set(null);
    this.searchQuery.set('');
  }

  /**
   * Selects an entry by path.
   * @param path The absolute path of the entry to select.
   */
  public select(path: string): void {
    this.selection.set(path);
  }

  /**
   * Sets the search query that filters the tree, or clears it when empty.
   * @param value The query text.
   */
  public setQuery(value: string): void {
    this.searchQuery.set(value);
  }

  /**
   * Expands the tree's directories. Honouring the workspace setting, this either expands only the
   * directories whose contents are already loaded, or reads and expands the entire tree from disk.
   * @returns Returns a promise that resolves once expansion completes.
   */
  public async expandAll(): Promise<void> {
    if (this.settings.fileExplorerExpandAll() === 'entire-tree') {
      await this.expandEntireTree();
    } else {
      this.treeNodes.update((nodes: readonly WorkspaceTreeNode[]): readonly WorkspaceTreeNode[] =>
        this.expandLoaded(nodes),
      );
    }
  }

  /**
   * Collapses every directory in the tree.
   */
  public collapseAll(): void {
    this.treeNodes.update((nodes: readonly WorkspaceTreeNode[]): readonly WorkspaceTreeNode[] =>
      this.collapse(nodes),
    );
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
    const listing: DirectoryListing | null = await (this.bridge?.invoke<DirectoryListing | null>(
      WorkspaceChannel.ReadDirectory,
      path,
    ) ?? Promise.resolve(null));
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
    this.searchQuery.set('');
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
      const expanded: boolean = node.type === 'directory' && node.expanded;
      rows.push({ node, depth, expanded });
      if (expanded && node.children !== null) {
        rows.push(...this.flatten(node.children, depth + 1));
      }
    }
    return rows;
  }

  /**
   * Flattens the tree into the rows that match a search query: a loaded entry is kept when its own name
   * matches or (for a directory) any descendant does, and a kept directory is force-expanded so its
   * matches show. Only loaded entries are searched (unexpanded directories are matched by their own
   * name alone).
   * @param nodes The nodes to filter.
   * @param depth The depth of these nodes beneath the root.
   * @param query The lower-cased search query.
   * @returns Returns the filtered rows in render order.
   */
  private filteredRows(
    nodes: readonly WorkspaceTreeNode[],
    depth: number,
    query: string,
  ): readonly WorkspaceTreeRow[] {
    const rows: WorkspaceTreeRow[] = [];
    for (const node of nodes) {
      const selfMatch: boolean = node.name.toLowerCase().includes(query);
      if (node.type === 'directory') {
        const childRows: readonly WorkspaceTreeRow[] =
          node.children !== null ? this.filteredRows(node.children, depth + 1, query) : [];
        if (selfMatch || childRows.length > 0) {
          rows.push({ node, depth, expanded: childRows.length > 0 });
          rows.push(...childRows);
        }
      } else if (selfMatch) {
        rows.push({ node, depth, expanded: false });
      }
    }
    return rows;
  }

  /**
   * Expands every directory whose children are already loaded, recursively, leaving unloaded
   * directories untouched.
   * @param nodes The nodes to expand.
   * @returns Returns the new node list with loaded directories expanded.
   */
  private expandLoaded(nodes: readonly WorkspaceTreeNode[]): readonly WorkspaceTreeNode[] {
    return nodes.map(
      (node: WorkspaceTreeNode): WorkspaceTreeNode =>
        node.type === 'directory' && node.children !== null
          ? { ...node, expanded: true, children: this.expandLoaded(node.children) }
          : node,
    );
  }

  /**
   * Collapses every directory, recursing through loaded children so nested expansion state is cleared
   * too.
   * @param nodes The nodes to collapse.
   * @returns Returns the new node list with every directory collapsed.
   */
  private collapse(nodes: readonly WorkspaceTreeNode[]): readonly WorkspaceTreeNode[] {
    return nodes.map(
      (node: WorkspaceTreeNode): WorkspaceTreeNode =>
        node.type === 'directory'
          ? {
              ...node,
              expanded: false,
              children: node.children !== null ? this.collapse(node.children) : null,
            }
          : node,
    );
  }

  /**
   * Reads and expands the entire tree from disk, loading each directory's children where they have not
   * been loaded yet. The result is applied in one update once the whole walk completes; it is discarded
   * when the open root changed while the walk was in flight.
   * @returns Returns a promise that resolves once the tree has been expanded.
   */
  private async expandEntireTree(): Promise<void> {
    const root: string | undefined = this.rootListing()?.path;
    const expandNode: (node: WorkspaceTreeNode) => Promise<WorkspaceTreeNode> = async (
      node: WorkspaceTreeNode,
    ): Promise<WorkspaceTreeNode> => {
      if (node.type !== 'directory') {
        return node;
      }
      let children: readonly WorkspaceTreeNode[];
      if (node.children !== null) {
        children = node.children;
      } else {
        const listing: DirectoryListing | null =
          await (this.bridge?.invoke<DirectoryListing | null>(
            WorkspaceChannel.ReadDirectory,
            node.path,
          ) ?? Promise.resolve(null));
        children =
          listing === null
            ? []
            : listing.entries.map((entry: DirectoryEntry): WorkspaceTreeNode => this.toNode(entry));
      }
      const expanded: readonly WorkspaceTreeNode[] = await Promise.all(children.map(expandNode));
      return { ...node, expanded: true, loading: false, children: expanded };
    };
    const nodes: readonly WorkspaceTreeNode[] = await Promise.all(this.treeNodes().map(expandNode));
    if (this.rootListing()?.path === root) {
      this.treeNodes.set(nodes);
    }
  }
}
