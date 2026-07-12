import { computed, inject, Service, signal, Signal, WritableSignal } from '@angular/core';
import { Bridge } from '@shared/api/bridge';
import { DirectoryChangeEvent } from '@shared/api/file-channels';
import {
  BinaryChunk,
  BinaryPatch,
  BinarySpan,
  DirectoryEntry,
  DirectoryEntryType,
  DirectoryListing,
  OpenSelection,
  WorkspaceChannel,
} from '@shared/api/workspace-channels';
import { DirectoryWatch } from '@shared/angular/services/directory-watch/directory-watch';
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
   * Holds the directory-watch service the open root is subscribed to, so on-disk changes made outside
   * the application are reflected in the tree.
   */
  private readonly directoryWatch: DirectoryWatch = inject(DirectoryWatch);

  /**
   * Holds the disposer of the open root's directory watch, or null when no folder is open.
   */
  private watchDisposer: (() => void) | null = null;

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
   * Writes in-place byte patches to a file, saving binary/hex edits without changing the file's
   * length. The main process honours the write only for trusted or in-workspace paths.
   * @param path The absolute path of the file to write.
   * @param patches The byte runs to overwrite, each with an offset and byte values.
   * @returns Returns true when the write succeeded, or false when it failed or ran outside Electron.
   */
  public writeBytes(path: string, patches: readonly BinaryPatch[]): Promise<boolean> {
    return (
      this.bridge?.invoke<boolean>(WorkspaceChannel.WriteBytes, path, patches) ??
      Promise.resolve(false)
    );
  }

  /**
   * Rewrites a file from a list of spans, saving binary/hex edits that insert or delete bytes. The main
   * process streams the spans (original ranges copied from the file, added ranges from the buffer) to a
   * temporary file and atomically renames it, so the file's length may change.
   * @param path The absolute path of the file to rewrite.
   * @param spans The spans that make up the new file content, in order.
   * @param added The added buffer the `added` spans index into.
   * @returns Returns true when the rewrite succeeded, or false when it failed or ran outside Electron.
   */
  public writePieces(
    path: string,
    spans: readonly BinarySpan[],
    added: Uint8Array,
  ): Promise<boolean> {
    return (
      this.bridge?.invoke<boolean>(WorkspaceChannel.WritePieces, path, spans, added) ??
      Promise.resolve(false)
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
    this.watchDisposer?.();
    this.watchDisposer = null;
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
   * Replaces the open root listing and seeds the tree with its children, re-pointing the directory
   * watch at the new root so external changes keep the tree current.
   * @param listing The root directory listing.
   */
  private setListing(listing: DirectoryListing): void {
    this.watchDisposer?.();
    this.watchDisposer = this.directoryWatch.watch(
      listing.path,
      (event: DirectoryChangeEvent): void => void this.onDirectoryChanged(event),
    );
    this.rootListing.set(listing);
    this.treeNodes.set(
      listing.entries.map((entry: DirectoryEntry): WorkspaceTreeNode => this.toNode(entry)),
    );
    this.selection.set(null);
    this.searchQuery.set('');
  }

  /**
   * Handles a burst of external on-disk changes under the open root, re-reading the affected
   * directories the tree has loaded and reconciling their entries in place. Directories the tree has
   * not loaded yet need nothing: they read fresh from disk when first expanded.
   * @param event The change burst.
   * @returns Returns a promise that resolves once the affected directories have been refreshed.
   */
  private async onDirectoryChanged(event: DirectoryChangeEvent): Promise<void> {
    const root: string | undefined = this.rootListing()?.path;
    if (root === undefined || event.root !== root) {
      return;
    }
    const targets: readonly string[] = event.overflow
      ? this.loadedDirectories()
      : event.directories.filter(
          (directory: string): boolean => directory === root || this.isLoadedDirectory(directory),
        );
    await Promise.all(targets.map((directory: string): Promise<void> => this.refresh(directory)));
  }

  /**
   * Lists the root and every directory whose children the tree has loaded, the set an overflowing
   * change burst refreshes.
   * @returns Returns the loaded directories' absolute paths.
   */
  private loadedDirectories(): readonly string[] {
    const root: string | undefined = this.rootListing()?.path;
    const paths: string[] = root === undefined ? [] : [root];
    const walk: (nodes: readonly WorkspaceTreeNode[]) => void = (
      nodes: readonly WorkspaceTreeNode[],
    ): void => {
      for (const node of nodes) {
        if (node.type === 'directory' && node.children !== null) {
          paths.push(node.path);
          walk(node.children);
        }
      }
    };
    walk(this.treeNodes());
    return paths;
  }

  /**
   * Determines whether a path is a directory whose children the tree has loaded.
   * @param path The absolute path to test.
   * @returns Returns true when the path is a loaded directory node.
   */
  private isLoadedDirectory(path: string): boolean {
    const node: WorkspaceTreeNode | null = this.find(this.treeNodes(), path);
    return node?.type === 'directory' && node.children !== null;
  }

  /**
   * Re-reads one directory's listing and reconciles its loaded children against it: entries that
   * survive keep their node (and with it their expansion and loaded subtree), added entries appear as
   * collapsed unloaded nodes, and removed entries drop out. A directory that can no longer be read
   * (deleted, or the root changed while the read was in flight) is left alone — its parent's refresh
   * removes its node.
   * @param path The absolute path of the directory to refresh.
   * @returns Returns a promise that resolves once the directory has been reconciled.
   */
  private async refresh(path: string): Promise<void> {
    const root: string | undefined = this.rootListing()?.path;
    const listing: DirectoryListing | null = await this.readDirectoryListing(path);
    if (listing === null || this.rootListing()?.path !== root) {
      return;
    }
    if (path === root) {
      this.treeNodes.update((nodes: readonly WorkspaceTreeNode[]): readonly WorkspaceTreeNode[] =>
        this.reconcile(nodes, listing.entries),
      );
      return;
    }
    this.update(
      path,
      (current: WorkspaceTreeNode): WorkspaceTreeNode =>
        current.children === null
          ? current
          : { ...current, children: this.reconcile(current.children, listing.entries) },
    );
  }

  /**
   * Reconciles a loaded child list against a directory's fresh entries, preserving the node (and so
   * the expansion state and loaded subtree) of every entry that survives.
   * @param existing The currently loaded child nodes.
   * @param entries The directory's fresh entries, in listing order.
   * @returns Returns the reconciled child list.
   */
  private reconcile(
    existing: readonly WorkspaceTreeNode[],
    entries: readonly DirectoryEntry[],
  ): readonly WorkspaceTreeNode[] {
    const byPath: Map<string, WorkspaceTreeNode> = new Map<string, WorkspaceTreeNode>(
      existing.map((node: WorkspaceTreeNode): [string, WorkspaceTreeNode] => [node.path, node]),
    );
    return entries.map((entry: DirectoryEntry): WorkspaceTreeNode => {
      const current: WorkspaceTreeNode | undefined = byPath.get(entry.path);
      return current?.type === entry.type ? current : this.toNode(entry);
    });
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
