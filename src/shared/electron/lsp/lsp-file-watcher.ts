import { existsSync, FSWatcher, watch, WatchEventType } from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { shouldForwardTreeEvent } from '../directory-watch-filter';
import { logger } from '../logger';
import { matchesAny } from './lsp-watch-glob';

/**
 * How long changes are coalesced before a `workspace/didChangeWatchedFiles` goes out. A checkout or
 * an install touches hundreds of files in a burst; one notification per file would have the server
 * re-evaluate its project model hundreds of times.
 */
const COALESCE_MS: number = 200;

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
 * matching paths are reported; a server that registered nothing gets everything that survives the
 * filter, which is what a server relying on the client's default watching expects.
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
   * Holds the server's registered patterns, or null when it registered none (report everything).
   */
  private patterns: readonly RegExp[] | null = null;

  /**
   * Holds the changes accumulated in the current coalescing window, keyed by root-relative path.
   */
  private readonly pending: Map<string, WatchEventType> = new Map<string, WatchEventType>();

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
   * Sets the patterns the server registered, replacing any previous set. Pass null to report every
   * change again.
   * @param patterns The compiled patterns, or null.
   */
  public setPatterns(patterns: readonly RegExp[] | null): void {
    this.patterns = patterns;
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
    if (eventType === 'rename' || !this.pending.has(filename)) {
      this.pending.set(filename, eventType);
    }
    this.timer ??= setTimeout((): void => this.flush(), COALESCE_MS);
  }

  /**
   * Turns the coalesced window into protocol events, applies the server's patterns, and delivers.
   */
  private flush(): void {
    this.timer = null;
    const events: FileEvent[] = [];
    for (const [relative, eventType] of this.pending) {
      if (this.patterns !== null && !matchesAny(relative, this.patterns)) {
        continue;
      }
      const absolute: string = path.join(this.root, relative);
      const type: FileChangeType =
        eventType === 'change'
          ? FileChangeType.Changed
          : existsSync(absolute)
            ? FileChangeType.Created
            : FileChangeType.Deleted;
      events.push({ uri: pathToFileURL(absolute).href, type });
    }
    this.pending.clear();
    if (events.length > 0) {
      this.deliver(events);
    }
  }
}
