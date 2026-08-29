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
  FileOperationResult,
  OpenSelection,
  WorkspaceChannel,
} from '@shared/api/workspace-channels';
import { DirectoryWatch } from '@shared/angular/services/directory-watch/directory-watch';
import { Log } from '@shared/angular/services/log/log';
import { Settings } from '@shared/angular/services/settings/settings';

/**
 * How long, in milliseconds, external change bursts are accumulated before the affected loaded
 * directories are re-read. The window is not extended by further events, so continuous churn
 * refreshes at this cadence instead of starving.
 */
const TREE_REFRESH_DEBOUNCE_MS: number = 300;

/**
 * How many directory re-reads a refresh pass issues concurrently. A widely-expanded tree can have
 * hundreds of loaded directories; an unbounded fan-out of IPC round-trips per burst starves the
 * bridge for everything else.
 */
const TREE_REFRESH_CONCURRENCY: number = 8;

/**
 * The directory names "Expand All (entire tree)" never descends into: dependency caches and build
 * outputs whose contents are enormous and never what the user meant to reveal.
 */
const EXPAND_SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set<string>([
  'node_modules',
  '.git',
  'bin',
  'obj',
  '.vs',
]);

/**
 * How many directories "Expand All (entire tree)" reads concurrently, and the most it reads in one
 * invocation before giving up on further depth — a bail-out so one click on an enormous repository
 * cannot hang the application.
 */
const EXPAND_CONCURRENCY: number = 16;
const EXPAND_DIRECTORY_CAP: number = 10_000;

/**
 * Runs a task over each item with a bounded number in flight at a time.
 * @param items The items to process.
 * @param limit The concurrency bound.
 * @param task The per-item task.
 * @returns Returns a promise that resolves once every task has settled.
 */
async function runBounded<T>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  const queue: T[] = [...items];
  const worker: () => Promise<void> = async (): Promise<void> => {
    for (let next: T | undefined = queue.shift(); next !== undefined; next = queue.shift()) {
      await task(next);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, worker));
}

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
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the disposer of the open root's directory watch, or null when no folder is open.
   */
  private watchDisposer: (() => void) | null = null;

  /**
   * Holds the changed directories accumulated for the pending refresh window: undefined when none is
   * pending, null when everything loaded must be treated as changed (an overflow burst).
   */
  private pendingRefreshDirs: Set<string> | null | undefined = undefined;

  /**
   * Holds the pending refresh-window timer, or null when none is running.
   */
  private refreshBurstTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Holds whether a refresh pass is currently running, so bursts never stack overlapping waves.
   */
  private treeRefreshRunning: boolean = false;

  /**
   * Holds the changes that arrived while a pass was running (null meaning everything), replayed once
   * it settles, or undefined when none did.
   */
  private treeRefreshDirty: Set<string> | null | undefined = undefined;

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
    this.log.info('Workspace', `Opened folder '${listing.name}'`, listing.path);
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
    this.log.info('Workspace', `Opened listing '${listing.name}'`, listing.path);
    this.setListing(listing);
  }

  /**
   * Closes the open folder, clearing the root, tree, and selection.
   * @returns Returns a promise that resolves once the folder has been closed.
   */
  public async closeFolder(): Promise<void> {
    const root: string | undefined = this.rootListing()?.path;
    if (root !== undefined) {
      this.log.info('Workspace', 'Closed folder', root);
      await (this.bridge?.invoke<void>(WorkspaceChannel.CloseFolder, root) ?? Promise.resolve());
    }
    this.releaseFolder();
  }

  /**
   * Releases the open folder's local state — the watcher, tree, and selection — WITHOUT closing the
   * root in the main process. Used when the root's lifecycle belongs to someone else: a worktree
   * container's host keeps the root open across the sub-view teardown that this workspace instance
   * dies in.
   */
  public releaseFolder(): void {
    this.watchDisposer?.();
    this.watchDisposer = null;
    if (this.refreshBurstTimer !== null) {
      clearTimeout(this.refreshBurstTimer);
      this.refreshBurstTimer = null;
    }
    this.pendingRefreshDirs = undefined;
    this.treeRefreshDirty = undefined;
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
   * Reveals an entry in the tree: expands (lazily loading where needed) every ancestor directory on
   * the way down, then selects the entry. Used to keep the explorer's selection following the active
   * document. Does nothing for a path outside the open root.
   * @param path The absolute path of the entry to reveal.
   * @returns Returns a promise that resolves once the entry has been revealed.
   */
  public async revealPath(path: string): Promise<void> {
    const root: string | undefined = this.rootListing()?.path;
    if (root === undefined || !this.isWithin(path, root)) {
      return;
    }
    // Walk down structurally: at each level, descend into the directory whose path prefixes the
    // target, expanding it (which lazily loads its children) when collapsed. Matching by the nodes'
    // own paths avoids reconstructing paths from separators.
    let nodes: readonly WorkspaceTreeNode[] = this.treeNodes();
    for (;;) {
      const ancestor: WorkspaceTreeNode | undefined = nodes.find(
        (node: WorkspaceTreeNode): boolean =>
          node.type === 'directory' && this.isWithin(path, node.path),
      );
      if (ancestor === undefined) {
        break;
      }
      if (!ancestor.expanded) {
        await this.toggleDirectory(ancestor.path);
      }
      const loaded: WorkspaceTreeNode | null = this.find(this.treeNodes(), ancestor.path);
      if (loaded?.children == null) {
        break;
      }
      nodes = loaded.children;
    }
    this.selection.set(path);
  }

  /**
   * Determines whether a path lies strictly within a directory (it extends the directory's path
   * across a separator).
   * @param path The absolute path to test.
   * @param directory The absolute directory path.
   * @returns Returns true when the path is inside the directory.
   */
  private isWithin(path: string, directory: string): boolean {
    return (
      path.length > directory.length &&
      path.startsWith(directory) &&
      /[\\/]/.test(path.charAt(directory.length))
    );
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
      this.update(path, (current: WorkspaceTreeNode): WorkspaceTreeNode => ({
        ...current,
        expanded: false,
      }));
      return;
    }
    if (node.children !== null) {
      this.update(path, (current: WorkspaceTreeNode): WorkspaceTreeNode => ({
        ...current,
        expanded: true,
      }));
      return;
    }
    this.update(path, (current: WorkspaceTreeNode): WorkspaceTreeNode => ({
      ...current,
      loading: true,
    }));
    const listing: DirectoryListing | null = await (this.bridge?.invoke<DirectoryListing | null>(
      WorkspaceChannel.ReadDirectory,
      path,
    ) ?? Promise.resolve(null));
    const children: readonly WorkspaceTreeNode[] =
      listing === null
        ? []
        : listing.entries.map((entry: DirectoryEntry): WorkspaceTreeNode => this.toNode(entry));
    this.update(path, (current: WorkspaceTreeNode): WorkspaceTreeNode => ({
      ...current,
      loading: false,
      expanded: true,
      children,
    }));
  }

  /**
   * Creates an empty file inside a workspace directory.
   * @param directory The absolute path of the parent directory.
   * @param name The new file's name (a single path segment).
   * @returns Returns the result describing success and the created path, or the failure's message.
   */
  public createFile(directory: string, name: string): Promise<FileOperationResult> {
    return this.mutate(WorkspaceChannel.CreateFile, directory, [directory, name]);
  }

  /**
   * Creates an empty folder inside a workspace directory.
   * @param directory The absolute path of the parent directory.
   * @param name The new folder's name (a single path segment).
   * @returns Returns the result describing success and the created path, or the failure's message.
   */
  public createFolder(directory: string, name: string): Promise<FileOperationResult> {
    return this.mutate(WorkspaceChannel.CreateFolder, directory, [directory, name]);
  }

  /**
   * Renames a file or folder within the workspace, keeping it in the same directory.
   * @param path The absolute path of the entry to rename.
   * @param name The new name (a single path segment).
   * @returns Returns the result describing success and the new path, or the failure's message.
   */
  public rename(path: string, name: string): Promise<FileOperationResult> {
    return this.mutate(WorkspaceChannel.Rename, this.parentDirectory(path), [path, name]);
  }

  /**
   * Deletes a file or folder within the workspace, to the operating system's trash where the platform
   * and filesystem allow it. The result's `trashed` flag says which happened, so a caller can report
   * an unrecoverable removal honestly rather than promising a Trash the entry never reached.
   * @param path The absolute path of the entry to delete.
   * @returns Returns the result describing success and how the entry went, or the failure's message.
   */
  public delete(path: string): Promise<FileOperationResult> {
    return this.mutate(WorkspaceChannel.Delete, this.parentDirectory(path), [path]);
  }

  /**
   * Runs a workspace mutation and reconciles the directory it changed.
   *
   * The refresh is explicit rather than left to the directory watcher, which also sees the change: a
   * caller that awaits one of these methods should find the tree already showing the result, and the
   * watcher's arrival is debounced and — on filesystems and container mounts where watching degrades —
   * not guaranteed at all. Reconciling twice is harmless, since {@link refresh} preserves the node of
   * every entry that survives.
   *
   * A failure leaves the tree alone: nothing changed on disk, so there is nothing to reconcile, and
   * re-reading would only cost a round trip to prove it.
   * @param channel The mutation channel to invoke.
   * @param directory The directory whose listing the mutation changes.
   * @param args The channel's arguments.
   * @returns Returns the mutation's result.
   */
  private async mutate(
    channel: WorkspaceChannel,
    directory: string,
    args: readonly unknown[],
  ): Promise<FileOperationResult> {
    const result: FileOperationResult = await (this.bridge?.invoke<FileOperationResult>(
      channel,
      ...args,
    ) ?? Promise.resolve({ success: false, error: 'Unavailable outside Electron' }));
    if (!result.success) {
      this.log.warn('Workspace', `${channel} failed`, result.error);
      return result;
    }
    this.log.info('Workspace', `${channel} succeeded`, result.path);
    if (this.isLoadedDirectory(directory) || this.rootListing()?.path === directory) {
      await this.refresh(directory);
    }
    return result;
  }

  /**
   * Resolves the directory a path sits in, by trimming its last segment.
   *
   * Written here rather than taken from `node:path`, which the renderer has no access to, and tolerant
   * of both separators because a Windows workspace's paths arrive back-slashed while much of the app's
   * own path handling normalises to forward slashes.
   * @param path The absolute path of an entry.
   * @returns Returns the parent directory's path, or the path itself when it has no separator.
   */
  private parentDirectory(path: string): string {
    const cut: number = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
    return cut <= 0 ? path : path.slice(0, cut);
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
    this.log.debug('Workspace', `Seeded tree at '${listing.path}'`, listing.entries.length);
  }

  /**
   * Handles a burst of external on-disk changes under the open root: the changed directories are
   * accumulated across a short debounce window, then the ones the tree has loaded are re-read a
   * bounded number at a time, with one refresh pass running at a time — a sustained burst (a large
   * checkout) refreshes at the debounce cadence instead of stacking overlapping waves of re-reads.
   * Directories the tree has not loaded need nothing: they read fresh from disk when first expanded.
   * @param event The change burst.
   */
  private onDirectoryChanged(event: DirectoryChangeEvent): void {
    const root: string | undefined = this.rootListing()?.path;
    if (root === undefined || event.root !== root) {
      return;
    }
    if (event.overflow) {
      this.pendingRefreshDirs = null;
    } else if (this.pendingRefreshDirs !== null) {
      this.pendingRefreshDirs ??= new Set<string>();
      for (const directory of event.directories) {
        this.pendingRefreshDirs.add(directory);
      }
    }
    if (this.refreshBurstTimer !== null) {
      return;
    }
    this.refreshBurstTimer = setTimeout((): void => {
      this.refreshBurstTimer = null;
      const pending: ReadonlySet<string> | null = this.pendingRefreshDirs ?? new Set<string>();
      this.pendingRefreshDirs = undefined;
      void this.runTreeRefresh(pending);
    }, TREE_REFRESH_DEBOUNCE_MS);
  }

  /**
   * Runs one refresh pass at a time over the given changed directories (null meaning every loaded
   * directory), re-reading a bounded number concurrently. Changes arriving mid-pass are merged and
   * replayed once it settles.
   * @param changed The changed directories, or null to refresh everything loaded.
   * @returns Returns a promise that resolves once the pass (and any replay) has started settling.
   */
  private async runTreeRefresh(changed: ReadonlySet<string> | null): Promise<void> {
    if (this.treeRefreshRunning) {
      this.treeRefreshDirty =
        changed === null || this.treeRefreshDirty === null
          ? null
          : new Set<string>([...(this.treeRefreshDirty ?? []), ...changed]);
      return;
    }
    this.treeRefreshRunning = true;
    try {
      const root: string | undefined = this.rootListing()?.path;
      if (root === undefined) {
        return;
      }
      const targets: readonly string[] =
        changed === null
          ? this.loadedDirectories()
          : [...changed].filter(
              (directory: string): boolean =>
                directory === root || this.isLoadedDirectory(directory),
            );
      await runBounded(targets, TREE_REFRESH_CONCURRENCY, (directory: string): Promise<void> =>
        this.refresh(directory),
      );
    } finally {
      this.treeRefreshRunning = false;
      const dirty: ReadonlySet<string> | null | undefined = this.treeRefreshDirty;
      this.treeRefreshDirty = undefined;
      if (dirty !== undefined) {
        void this.runTreeRefresh(dirty);
      }
    }
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
    this.update(path, (current: WorkspaceTreeNode): WorkspaceTreeNode =>
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
    return nodes.map((node: WorkspaceTreeNode): WorkspaceTreeNode =>
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
    return nodes.map((node: WorkspaceTreeNode): WorkspaceTreeNode =>
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
    // Bound the walk: dependency caches and build outputs are never descended into, directory reads
    // are limited to a fixed number in flight, and past a directory cap the remaining branches stay
    // collapsed — one click on an enormous repository must not hang the application.
    let active: number = 0;
    const waiters: (() => void)[] = [];
    const acquire: () => Promise<void> = (): Promise<void> => {
      if (active < EXPAND_CONCURRENCY) {
        active += 1;
        return Promise.resolve();
      }
      return new Promise<void>((resolve: () => void): void => {
        waiters.push((): void => {
          active += 1;
          resolve();
        });
      });
    };
    const release: () => void = (): void => {
      active -= 1;
      waiters.shift()?.();
    };
    let visited: number = 0;
    const expandNode: (node: WorkspaceTreeNode) => Promise<WorkspaceTreeNode> = async (
      node: WorkspaceTreeNode,
    ): Promise<WorkspaceTreeNode> => {
      if (node.type !== 'directory') {
        return node;
      }
      if (EXPAND_SKIPPED_DIRECTORIES.has(node.name) || visited >= EXPAND_DIRECTORY_CAP) {
        return node;
      }
      visited += 1;
      let children: readonly WorkspaceTreeNode[];
      if (node.children !== null) {
        children = node.children;
      } else {
        await acquire();
        try {
          const listing: DirectoryListing | null =
            await (this.bridge?.invoke<DirectoryListing | null>(
              WorkspaceChannel.ReadDirectory,
              node.path,
            ) ?? Promise.resolve(null));
          children =
            listing === null
              ? []
              : listing.entries.map((entry: DirectoryEntry): WorkspaceTreeNode =>
                  this.toNode(entry),
                );
        } finally {
          release();
        }
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
