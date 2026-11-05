import { FSWatcher, watch, WatchEventType } from 'node:fs';
import { access } from 'node:fs/promises';
import * as path from 'node:path';
import { setImmediate as yieldToEventLoop } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { shouldForwardTreeEvent } from '../directory-watch-filter';
import { logger } from '../logger';
import { matchesAny, WatchRegistrations } from './lsp-watch-glob';

/**
 * How long changes are coalesced before a `workspace/didChangeWatchedFiles` goes out. A checkout or
 * an install touches hundreds of files in a burst; one notification per file would have the server
 * re-evaluate its project model hundreds of times.
 */
const COALESCE_MS: number = 200;

/**
 * Specifies the most distinct paths one window holds. A branch switch or an unpacked archive touches
 * far fewer files than a server can usefully hear about in one notification; past this it is the
 * main process's memory at stake, and the server is left to find out about the rest when it next
 * reads them.
 */
export const MAX_PENDING_PATHS: number = 50_000;

/**
 * Specifies how many paths are resolved between turns of the event loop.
 */
const FLUSH_BATCH_SIZE: number = 256;

/**
 * The `FileChangeType` values of the protocol.
 */
export const enum FileChangeType {
  Created = 1,
  Changed = 2,
  Deleted = 3,
}

/**
 * One entry of a `workspace/didChangeWatchedFiles` notification.
 */
export interface FileEvent {
  /**
   * Gets the changed file's `file:` URI.
   */
  readonly uri: string;

  /**
   * Gets what happened to it.
   */
  readonly type: FileChangeType;
}

/**
 * Watches a session's workspace root on the server's behalf and reports what changed, so the server
 * learns about the world moving under it — `npm install`, a branch switch, files created by a tool or
 * an agent — rather than seeing the workspace exactly once, at spawn.
 *
 * Events are filtered through the same policy the explorers use (build outputs, dependency caches and
 * git's internal bookkeeping are dropped), coalesced, and deduplicated per path. When the server has
 * registered watch patterns (`client/registerCapability` for `workspace/didChangeWatchedFiles`), only
 * paths matching one of its live registrations are reported; a server that registered nothing gets
 * everything that survives the filter, which is what a server relying on the client's default
 * watching expects.
 */
export class LspFileWatcher {
  /**
   * Holds the watched root.
   */
  private readonly root: string;

  /**
   * Holds the callback that delivers a coalesced batch of events.
   */
  private readonly deliver: (events: readonly FileEvent[]) => void;

  /**
   * Holds the native recursive watcher, or null once closed or when the root could not be watched.
   */
  private watcher: FSWatcher | null = null;

  /**
   * Holds the server's watch registrations, whose union filters what is reported.
   */
  private readonly registrations: WatchRegistrations;

  /**
   * Holds the changes accumulated in the current coalescing window, keyed by root-relative path.
   */
  private pending: Map<string, WatchEventType> = new Map<string, WatchEventType>();

  /**
   * Holds whether a flush is running, so two never interleave and reorder what the server hears.
   */
  private flushing: boolean = false;

  /**
   * Holds whether this window has already said it dropped paths, so a storm logs once.
   */
  private overflowed: boolean = false;

  /**
   * Holds the coalescing timer, or null when no window is open.
   */
  private timer: NodeJS.Timeout | null = null;

  /**
   * Initializes a new instance of the {@link LspFileWatcher} class and starts watching.
   * @param root The absolute workspace root to watch.
   * @param deliver The callback that receives each coalesced batch of events.
   */
  public constructor(root: string, deliver: (events: readonly FileEvent[]) => void) {
    this.root = root;
    this.deliver = deliver;
    this.registrations = new WatchRegistrations(root);
    try {
      this.watcher = watch(
        root,
        { recursive: true },
        (eventType: WatchEventType, filename: string | Buffer | null): void =>
          this.onEvent(eventType, filename),
      );
      this.watcher.on('error', (error: Error): void => {
        logger.warn('LspFileWatcher', `Watcher errored for ${root}; stopping`, error);
        this.close();
      });
    } catch (error: unknown) {
      logger.error('LspFileWatcher', `Cannot watch ${root} for a language server`, error);
      this.watcher = null;
    }
  }

  /**
   * Adds a server's watch registration; what is reported becomes the union of every live one.
   * @param id The registration id.
   * @param watchers The registration's `watchers`, untrusted.
   */
  public register(id: string, watchers: unknown): void {
    this.registrations.register(id, watchers);
  }

  /**
   * Removes a server's watch registration. With none left, every change is reported again.
   * @param id The registration id.
   */
  public unregister(id: string): void {
    this.registrations.unregister(id);
  }

  /**
   * Gets how many watch registrations are live, for diagnostics.
   */
  public get registrationCount(): number {
    return this.registrations.size;
  }

  /**
   * Stops watching and discards anything pending.
   */
  public close(): void {
    this.watcher?.close();
    this.watcher = null;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.pending.clear();
  }

  /**
   * Records a native event into the coalescing window.
   * @param eventType The native event kind.
   * @param filename The changed entry's root-relative path, or null when withheld.
   */
  private onEvent(eventType: WatchEventType, filename: string | Buffer | null): void {
    // A native callback can land after close(); it must not reopen a coalescing window.
    if (this.watcher === null || typeof filename !== 'string' || filename.length === 0) {
      return;
    }
    if (!shouldForwardTreeEvent(filename)) {
      return;
    }
    // A rename after a change (write then move into place, as editors and package managers do) is
    // the more significant of the two, and a rename resolves to created-or-deleted at flush time.
    if (!this.pending.has(filename) && this.pending.size >= MAX_PENDING_PATHS) {
      if (!this.overflowed) {
        this.overflowed = true;
        logger.warn('LspFileWatcher', `Over ${MAX_PENDING_PATHS} changes under ${this.root}`);
      }
    } else if (eventType === 'rename' || !this.pending.has(filename)) {
      this.pending.set(filename, eventType);
    }
    this.schedule();
  }

  /**
   * Opens a coalescing window, unless one is open or a flush will open it on finishing.
   */
  private schedule(): void {
    if (!this.flushing) {
      this.timer ??= setTimeout((): void => void this.flush(), COALESCE_MS);
    }
  }

  /**
   * Turns the coalesced window into protocol events, applies the server's patterns, and delivers.
   * Runs in batches: a package install resolves tens of thousands of paths here, and doing them in
   * one go holds up everything else the main process is doing.
   */
  private async flush(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.flushing = true;
    const window: readonly [string, WatchEventType][] = [...this.pending];
    this.pending = new Map<string, WatchEventType>();
    this.overflowed = false;
    const patterns: readonly RegExp[] | null = this.registrations.patterns();
    const wanted: readonly [string, WatchEventType][] =
      patterns === null
        ? window
        : window.filter(([relative]: [string, WatchEventType]): boolean =>
            matchesAny(relative, patterns),
          );
    const events: FileEvent[] = [];
    for (let start: number = 0; start < wanted.length; start += FLUSH_BATCH_SIZE) {
      const batch: readonly [string, WatchEventType][] = wanted.slice(
        start,
        start + FLUSH_BATCH_SIZE,
      );
      events.push(
        ...(await Promise.all(
          batch.map(([relative, eventType]: [string, WatchEventType]): Promise<FileEvent> =>
            this.toFileEvent(relative, eventType),
          ),
        )),
      );
      await yieldToEventLoop();
      if (this.watcher === null) {
        // Closed while resolving; nothing may reach a server that has gone.
        this.flushing = false;
        return;
      }
    }
    this.flushing = false;
    if (events.length > 0) {
      this.deliver(events);
    }
    if (this.pending.size > 0) {
      this.schedule();
    }
  }

  /**
   * Builds the protocol event for a path.
   * @param relative The root-relative path.
   * @param eventType The native event kind.
   * @returns Returns the event.
   */
  private async toFileEvent(relative: string, eventType: WatchEventType): Promise<FileEvent> {
    const absolute: string = path.join(this.root, relative);
    const type: FileChangeType =
      eventType === 'change'
        ? FileChangeType.Changed
        : (await pathExists(absolute))
          ? FileChangeType.Created
          : FileChangeType.Deleted;
    return { uri: pathToFileURL(absolute).href, type };
  }
}

/**
 * Determines whether a path exists.
 * @param target The absolute path.
 * @returns Returns true when it does.
 */
async function pathExists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}
