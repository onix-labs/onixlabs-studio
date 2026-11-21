import { promises as fs } from 'node:fs';
import type { Dirent, Stats } from 'node:fs';
import * as path from 'node:path';
import { logger } from '../logger';
import type {
  PollDescent,
  TreeWatch,
  TreeWatchErrorListener,
  TreeWatchListener,
} from './tree-watch';

/**
 * Specifies the most entries one poll keeps track of. A poll reads every entry it covers on every pass;
 * past this, a tree on a network share costs more to poll than the changes are worth, and the rest is
 * left unwatched rather than slowing everything else down.
 */
export const MAX_POLLED_ENTRIES: number = 100_000;

/**
 * Specifies how many entries are examined at once, so a large folder does not open thousands of
 * requests to a share at the same moment.
 */
const STAT_BATCH_SIZE: number = 64;

/**
 * Describes how a polling watcher runs.
 */
export interface PollingOptions {
  /**
   * Gets how long to wait between polls, in milliseconds.
   */
  readonly intervalMs: number;

  /**
   * Gets whether everything beneath the root is polled, rather than only its own entries.
   */
  readonly recursive: boolean;

  /**
   * Gets which directories are read, beneath the root.
   */
  readonly descend: PollDescent;
}

/**
 * Describes what a poll saw of one entry.
 */
interface PolledEntry {
  /**
   * Gets whether the entry is a directory.
   */
  readonly directory: boolean;

  /**
   * Gets when the entry last changed, in milliseconds.
   */
  readonly modified: number;

  /**
   * Gets the entry's size in bytes.
   */
  readonly size: number;
}

/**
 * Watches a folder by reading it on a timer and comparing what it finds with what it found before
 * (#1254), for the folders where the operating system's own notifications do not arrive: a network
 * share another machine writes to, or a container mount the container writes to.
 *
 * It reports what `fs.watch` would: `rename` for an entry that appeared or went away and `change` for
 * a file whose size or modification time moved, with the path relative to the root. A directory's own
 * timestamp is not reported, since what changed inside it is. Links are recorded but never followed,
 * so a link back up the tree cannot make a poll endless. The first poll only records; it reports
 * nothing.
 */
export class PollingTreeWatcher implements TreeWatch {
  /**
   * Holds the watched root.
   */
  private readonly root: string;

  /**
   * Holds how the watcher runs.
   */
  private readonly options: PollingOptions;

  /**
   * Holds the callback that receives each change.
   */
  private readonly listener: TreeWatchListener;

  /**
   * Holds the callback told when the root cannot be read.
   */
  private readonly onError: TreeWatchErrorListener;

  /**
   * Holds what the last poll saw, keyed by path relative to the root, or undefined before the first.
   */
  private snapshot: Map<string, PolledEntry> | undefined = undefined;

  /**
   * Holds the timer for the next poll, or undefined while one runs or after closing.
   */
  private timer: NodeJS.Timeout | undefined = undefined;

  /**
   * Holds whether the watcher has been closed.
   */
  private closed: boolean = false;

  /**
   * Holds whether the entry cap has been reported, so it is logged once.
   */
  private capped: boolean = false;

  /**
   * Initializes a new instance of the {@link PollingTreeWatcher} class and starts polling.
   * @param root The absolute folder to watch.
   * @param options How the watcher runs.
   * @param listener Called with each change.
   * @param onError Called once if the root cannot be read, after which nothing more is reported.
   */
  public constructor(
    root: string,
    options: PollingOptions,
    listener: TreeWatchListener,
    onError: TreeWatchErrorListener,
  ) {
    this.root = root;
    this.options = options;
    this.listener = listener;
    this.onError = onError;
    void this.poll();
  }

  /**
   * Stops polling. A poll already reading the disk finishes without reporting.
   */
  public close(): void {
    this.closed = true;
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  /**
   * Reads the tree, reports what changed since the last poll, and schedules the next.
   * @returns Returns a promise that resolves once the poll is done.
   */
  private async poll(): Promise<void> {
    let current: Map<string, PolledEntry>;
    try {
      current = await this.scan();
    } catch (error: unknown) {
      if (!this.closed) {
        this.closed = true;
        this.onError(error instanceof Error ? error : new Error(String(error)));
      }
      return;
    }
    if (this.closed) {
      return;
    }
    const previous: Map<string, PolledEntry> | undefined = this.snapshot;
    this.snapshot = current;
    if (previous !== undefined) {
      this.report(previous, current);
    }
    if (!this.closed) {
      this.timer = setTimeout((): void => {
        this.timer = undefined;
        void this.poll();
      }, this.options.intervalMs);
      // A poll must never be what keeps the process alive.
      this.timer.unref();
    }
  }

  /**
   * Reports the differences between two polls.
   * @param previous What the last poll saw.
   * @param current What this poll saw.
   */
  private report(previous: Map<string, PolledEntry>, current: Map<string, PolledEntry>): void {
    for (const [relative, entry] of current) {
      if (this.closed) {
        return;
      }
      const before: PolledEntry | undefined = previous.get(relative);
      if (before?.directory !== entry.directory) {
        this.listener('rename', relative);
      } else if (
        !entry.directory &&
        (before.modified !== entry.modified || before.size !== entry.size)
      ) {
        this.listener('change', relative);
      }
    }
    for (const relative of previous.keys()) {
      if (this.closed) {
        return;
      }
      if (!current.has(relative)) {
        this.listener('rename', relative);
      }
    }
  }

  /**
   * Reads every entry the watcher covers.
   * @returns Returns the entries, keyed by path relative to the root.
   * @throws Throws when the root itself cannot be read.
   */
  private async scan(): Promise<Map<string, PolledEntry>> {
    const entries: Map<string, PolledEntry> = new Map<string, PolledEntry>();
    const pending: string[] = [''];
    for (let next: number = 0; next < pending.length && !this.closed; next++) {
      const relativeDirectory: string = pending[next];
      let children: Dirent[];
      try {
        children = await fs.readdir(path.join(this.root, relativeDirectory), {
          withFileTypes: true,
        });
      } catch (error: unknown) {
        if (relativeDirectory === '') {
          throw error;
        }
        // A folder that went away mid-poll, or one this user cannot read, is simply not there.
        continue;
      }
      for (let start: number = 0; start < children.length; start += STAT_BATCH_SIZE) {
        if (entries.size >= MAX_POLLED_ENTRIES) {
          this.reportCap();
          return entries;
        }
        const batch: readonly Dirent[] = children.slice(start, start + STAT_BATCH_SIZE);
        const examined: readonly (readonly [string, PolledEntry] | undefined)[] = await Promise.all(
          batch.map((child: Dirent): Promise<readonly [string, PolledEntry] | undefined> =>
            this.examine(relativeDirectory, child),
          ),
        );
        for (const found of examined) {
          if (found === undefined) {
            continue;
          }
          const [relative, entry]: readonly [string, PolledEntry] = found;
          entries.set(relative, entry);
          if (entry.directory && this.options.recursive && this.options.descend(relative)) {
            pending.push(relative);
          }
        }
      }
    }
    return entries;
  }

  /**
   * Reads one entry's size and modification time, without following a link.
   * @param relativeDirectory The directory it is in, relative to the root.
   * @param child The entry.
   * @returns Returns its relative path and what was seen, or undefined when it went away meanwhile.
   */
  private async examine(
    relativeDirectory: string,
    child: Dirent,
  ): Promise<readonly [string, PolledEntry] | undefined> {
    const relative: string =
      relativeDirectory === '' ? child.name : path.join(relativeDirectory, child.name);
    try {
      const stats: Stats = await fs.lstat(path.join(this.root, relative));
      return [
        relative,
        { directory: stats.isDirectory(), modified: stats.mtimeMs, size: stats.size },
      ] as const;
    } catch {
      return undefined;
    }
  }

  /**
   * Logs, once, that the tree is larger than a poll keeps track of.
   */
  private reportCap(): void {
    if (!this.capped) {
      this.capped = true;
      logger.warn(
        'PollingTreeWatcher',
        `${this.root} has more than ${MAX_POLLED_ENTRIES} entries; the rest are not polled`,
      );
    }
  }
}
