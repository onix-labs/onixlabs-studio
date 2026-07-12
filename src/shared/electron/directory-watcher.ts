import { BrowserWindow, ipcMain, IpcMainInvokeEvent } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DirectoryChangeEvent, FileChannel } from '@shared/api/file-channels';

/**
 * Specifies how long, in milliseconds, changes under a root are coalesced before notifying. The timer
 * is not restarted by further events, so a continuous burst (a build, a checkout) still notifies at
 * this cadence rather than being deferred until the burst ends.
 */
const COALESCE_MS: number = 200;

/**
 * Specifies the maximum number of distinct changed directories reported per notification. A burst
 * touching more directories than this collapses into an overflow notification, telling subscribers to
 * refresh everything they have loaded instead of receiving an unbounded path list.
 */
const MAX_DIRECTORIES: number = 128;

/**
 * Tracks a watched root: its native recursive watcher and its subscriber reference count.
 */
interface WatchedRoot {
  /**
   * Gets the native recursive watcher.
   */
  readonly watcher: fs.FSWatcher;

  /**
   * Gets or sets the number of renderer subscriptions holding this watch open.
   */
  count: number;
}

/**
 * Tracks the changes accumulated for a root while its coalescing timer runs.
 */
interface PendingChanges {
  /**
   * Gets the absolute paths of the directories whose entries changed.
   */
  readonly directories: Set<string>;

  /**
   * Gets or sets a value indicating whether the burst overflowed the per-directory cap (or the
   * platform withheld a changed path).
   */
  overflow: boolean;

  /**
   * Gets the timer that fires the coalesced notification.
   */
  readonly timer: NodeJS.Timeout;
}

/**
 * Watches directory trees on disk on behalf of the renderer and notifies it when entries anywhere
 * beneath a watched root are added, updated, or deleted. Complements {@link FileWatcher} (which
 * watches single open files): this is the tree-shaped feed behind the explorers' live refresh and the
 * source-control view's automatic git status. Roots are watched recursively, reference-counted so the
 * same root can be watched from several places, and changes are coalesced into per-directory bursts.
 * One instance is owned by the main process.
 */
export class DirectoryWatcher {
  /**
   * Holds the function used to resolve the window change notifications are sent to.
   */
  private readonly windowGetter: () => BrowserWindow | null;

  /**
   * Holds the watched roots, keyed by absolute directory path.
   */
  private readonly roots: Map<string, WatchedRoot> = new Map<string, WatchedRoot>();

  /**
   * Holds the changes accumulated per root while a coalescing timer runs, keyed by root path.
   */
  private readonly pending: Map<string, PendingChanges> = new Map<string, PendingChanges>();

  /**
   * Initializes a new instance of the {@link DirectoryWatcher} class.
   * @param windowGetter A function that returns the window change notifications are sent to.
   */
  public constructor(windowGetter: () => BrowserWindow | null) {
    this.windowGetter = windowGetter;
  }

  /**
   * Registers the directory-watch IPC handlers.
   */
  public register(): void {
    ipcMain.handle(
      FileChannel.WatchDirectory,
      (_event: IpcMainInvokeEvent, root: unknown): void => {
        if (typeof root === 'string') {
          this.watch(root);
        }
      },
    );
    ipcMain.handle(
      FileChannel.UnwatchDirectory,
      (_event: IpcMainInvokeEvent, root: unknown): void => {
        if (typeof root === 'string') {
          this.unwatch(root);
        }
      },
    );
  }

  /**
   * Closes every root watcher and clears pending timers. Called on application shutdown.
   */
  public disposeAll(): void {
    for (const root of this.roots.values()) {
      root.watcher.close();
    }
    this.roots.clear();
    for (const changes of this.pending.values()) {
      clearTimeout(changes.timer);
    }
    this.pending.clear();
  }

  /**
   * Begins watching a directory tree (reference-counted), opening a recursive watcher if needed.
   * @param root The absolute directory path to watch.
   */
  private watch(root: string): void {
    const existing: WatchedRoot | undefined = this.roots.get(root);
    if (existing !== undefined) {
      existing.count += 1;
      return;
    }
    try {
      const watcher: fs.FSWatcher = fs.watch(
        root,
        { recursive: true },
        (_eventType: fs.WatchEventType, filename: string | Buffer | null): void =>
          this.onEvent(root, filename),
      );
      // A vanished root (deleted, unmounted) errors rather than events; report it as an overflow so
      // subscribers re-read what they show and discover the root is gone, then drop the dead watcher.
      watcher.on('error', (): void => {
        watcher.close();
        this.roots.delete(root);
        this.recordOverflow(root);
      });
      this.roots.set(root, { watcher, count: 1 });
    } catch {
      // The root may not exist or be unwatchable; treat as a no-op.
    }
  }

  /**
   * Stops watching a directory tree (reference-counted), closing the watcher when unused.
   * @param root The absolute directory path to stop watching.
   */
  private unwatch(root: string): void {
    const existing: WatchedRoot | undefined = this.roots.get(root);
    if (existing === undefined) {
      return;
    }
    existing.count -= 1;
    if (existing.count > 0) {
      return;
    }
    existing.watcher.close();
    this.roots.delete(root);
    const changes: PendingChanges | undefined = this.pending.get(root);
    if (changes !== undefined) {
      clearTimeout(changes.timer);
      this.pending.delete(root);
    }
  }

  /**
   * Handles a native recursive event, recording the changed entry's parent directory (whose listing
   * is what changed) into the root's coalescing window.
   * @param root The watched root the event occurred under.
   * @param filename The changed entry's path relative to the root, or null when withheld.
   */
  private onEvent(root: string, filename: string | Buffer | null): void {
    if (typeof filename !== 'string' || filename.length === 0) {
      this.recordOverflow(root);
      return;
    }
    const changes: PendingChanges = this.ensurePending(root);
    if (changes.overflow) {
      return;
    }
    changes.directories.add(path.dirname(path.join(root, filename)));
    if (changes.directories.size > MAX_DIRECTORIES) {
      changes.overflow = true;
      changes.directories.clear();
    }
  }

  /**
   * Marks the root's current coalescing window as overflowed, so the notification tells subscribers
   * to refresh everything rather than a directory list.
   * @param root The watched root.
   */
  private recordOverflow(root: string): void {
    const changes: PendingChanges = this.ensurePending(root);
    changes.overflow = true;
    changes.directories.clear();
  }

  /**
   * Gets the root's pending changes, starting its coalescing window (and timer) when none is open.
   * @param root The watched root.
   * @returns Returns the root's pending changes.
   */
  private ensurePending(root: string): PendingChanges {
    let changes: PendingChanges | undefined = this.pending.get(root);
    if (changes === undefined) {
      changes = {
        directories: new Set<string>(),
        overflow: false,
        timer: setTimeout((): void => this.flush(root), COALESCE_MS),
      };
      this.pending.set(root, changes);
    }
    return changes;
  }

  /**
   * Sends the root's coalesced changes to the renderer window and closes the coalescing window.
   * @param root The watched root to flush.
   */
  private flush(root: string): void {
    const changes: PendingChanges | undefined = this.pending.get(root);
    this.pending.delete(root);
    if (changes === undefined) {
      return;
    }
    const window: BrowserWindow | null = this.windowGetter();
    if (window === null || window.isDestroyed()) {
      return;
    }
    const event: DirectoryChangeEvent = {
      root,
      directories: [...changes.directories],
      overflow: changes.overflow,
    };
    window.webContents.send(FileChannel.DirectoryChanged, event);
  }
}
