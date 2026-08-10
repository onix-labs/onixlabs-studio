import { BrowserWindow, ipcMain, IpcMainInvokeEvent, WebContents } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DirectoryChangeEvent, FileChannel } from '@shared/api/file-channels';
import { shouldForwardTreeEvent } from './directory-watch-filter';
import { logger } from './logger';

/**
 * Specifies how long, in milliseconds, changes under a root are coalesced before notifying. The timer
 * is not restarted by further events, so a continuous burst (a build, a checkout) still notifies at
 * this cadence rather than being deferred until the burst ends.
 */
const COALESCE_MS: number = 200;

/**
 * Specifies the maximum number of distinct changed directories reported per notification. A burst
 * touching more directories than this collapses into an overflow notification, telling subscribers to
 * refresh everything they have loaded instead of receiving an unbounded path list. Build-output and
 * dependency churn never counts toward this cap (it is dropped before coalescing), so an overflow
 * means a genuinely tree-wide change such as a large checkout.
 */
const MAX_DIRECTORIES: number = 512;

/**
 * Tracks a watched root: its native recursive watcher and the renderer subscriptions holding it open.
 */
interface WatchedRoot {
  /**
   * Gets the native recursive watcher.
   */
  readonly watcher: fs.FSWatcher;

  /**
   * Gets the number of subscriptions holding this watch open, keyed by the id of the renderer
   * (webContents) that registered them, so a crashed or reloaded renderer's holds can be released
   * without affecting other renderers.
   */
  readonly holders: Map<number, number>;
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
   * Holds the ids of the renderers whose destruction is already being observed, so each renderer gets
   * one destroyed-listener regardless of how many roots it watches.
   */
  private readonly trackedSenders: Set<number> = new Set<number>();

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
    ipcMain.handle(FileChannel.WatchDirectory, (event: IpcMainInvokeEvent, root: unknown): void => {
      if (typeof root === 'string') {
        this.watch(root, event.sender);
      }
    });
    ipcMain.handle(
      FileChannel.UnwatchDirectory,
      (event: IpcMainInvokeEvent, root: unknown): void => {
        if (typeof root === 'string') {
          this.unwatch(root, event.sender.id);
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
    this.trackedSenders.clear();
  }

  /**
   * Begins watching a directory tree (reference-counted per renderer), opening a recursive watcher if
   * needed. The subscribing renderer's destruction is observed so a crashed or reloaded renderer
   * releases its holds — otherwise its watches would leak for the rest of the session, since the
   * fresh renderer knows nothing of its predecessor's subscriptions.
   * @param root The absolute directory path to watch.
   * @param sender The renderer registering the subscription.
   */
  private watch(root: string, sender: WebContents): void {
    if (!this.trackedSenders.has(sender.id)) {
      this.trackedSenders.add(sender.id);
      sender.once('destroyed', (): void => this.dropSender(sender.id));
    }
    const existing: WatchedRoot | undefined = this.roots.get(root);
    if (existing !== undefined) {
      existing.holders.set(sender.id, (existing.holders.get(sender.id) ?? 0) + 1);
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
      this.roots.set(root, { watcher, holders: new Map<number, number>([[sender.id, 1]]) });
    } catch (error: unknown) {
      logger.debug('DirectoryWatcher', `Cannot watch ${root}`, error);
    }
  }

  /**
   * Stops watching a directory tree (reference-counted per renderer), closing the watcher when no
   * renderer holds it any longer.
   * @param root The absolute directory path to stop watching.
   * @param senderId The id of the renderer releasing the subscription.
   */
  private unwatch(root: string, senderId: number): void {
    const existing: WatchedRoot | undefined = this.roots.get(root);
    if (existing === undefined) {
      return;
    }
    const count: number | undefined = existing.holders.get(senderId);
    if (count === undefined) {
      return;
    }
    if (count > 1) {
      existing.holders.set(senderId, count - 1);
      return;
    }
    existing.holders.delete(senderId);
    if (existing.holders.size === 0) {
      this.close(root, existing);
    }
  }

  /**
   * Releases every hold a destroyed renderer had, closing the watchers only it was keeping open.
   * @param senderId The id of the destroyed renderer.
   */
  private dropSender(senderId: number): void {
    this.trackedSenders.delete(senderId);
    for (const [root, existing] of [...this.roots]) {
      if (existing.holders.delete(senderId) && existing.holders.size === 0) {
        this.close(root, existing);
      }
    }
  }

  /**
   * Closes a root's watcher and discards its pending changes.
   * @param root The watched root to close.
   * @param existing The root's watch entry.
   */
  private close(root: string, existing: WatchedRoot): void {
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
   * is what changed) into the root's coalescing window. Churn from build outputs, dependency caches,
   * and git's internal bookkeeping is dropped here, before it can open a coalescing window or count
   * toward the overflow cap — a build must not become a refresh storm for every subscriber.
   * @param root The watched root the event occurred under.
   * @param filename The changed entry's path relative to the root, or null when withheld.
   */
  private onEvent(root: string, filename: string | Buffer | null): void {
    if (typeof filename !== 'string' || filename.length === 0) {
      this.recordOverflow(root);
      return;
    }
    if (!shouldForwardTreeEvent(filename)) {
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
