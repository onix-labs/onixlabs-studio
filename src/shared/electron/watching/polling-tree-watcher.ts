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
 * Specifies how many polls in a row may fail to read the root before the watcher gives up. A share
 * that drops for a moment (a timeout, a stale handle, a host that is briefly down) answers again on a
 * later poll, and the watch should still be there when it does.
 */
export const MAX_ROOT_FAILURES: number = 5;

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

  /**
   * Gets, when set, the only entries of the root that are looked at, by name: the root is not listed
   * and nothing else in it is examined. For a watcher that cares about a few files in a folder.
   */
  readonly files?: () => readonly string[];
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
   * Gets when the entry's contents last changed, in milliseconds.
   */
  readonly modified: number;

  /**
   * Gets when the entry's metadata last changed, in milliseconds, which a rewrite moves even where
   * the modification time's granularity hides it.
   */
  readonly changed: number;

  /**
   * Gets the entry's size in bytes.
   */
  readonly size: number;

  /**
   * Gets the entry's inode, which changes when a file is replaced by another (write then rename).
   */
  readonly inode: number;
}

/**
 * Describes everything one poll saw.
 */
interface PollSnapshot {
  /**
   * Gets the entries, keyed by path relative to the root.
   */
  readonly entries: Map<string, PolledEntry>;

  /**
   * Gets the directories whose entries were read (the root is ''), or, when only some files are
   * looked at, the files examined. An entry inside a directory that was not read is not known to be
   * new or gone, only to have come into or out of view.
   */
  readonly read: Set<string>;
}

/**
 * Describes what examining one entry found.
 */
type Examined = readonly [string, PolledEntry] | 'gone' | 'failed';

/**
 * Determines whether a file-system error means the path is not there, rather than that it could not
 * be reached just now.
 * @param error The error.
 * @returns Returns true for a missing path or a path through something that is not a directory.
 */
function isGone(error: unknown): boolean {
  const code: unknown = error instanceof Error && 'code' in error ? error.code : undefined;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

/**
 * Gets the directory an entry is listed in, relative to the root.
 * @param relative The entry's path relative to the root.
 * @returns Returns the directory, '' for the root.
 */
function parentOf(relative: string): string {
  const parent: string = path.dirname(relative);
  return parent === '.' ? '' : parent;
}

/**
 * Watches a folder by reading it on a timer and comparing what it finds with what it found before
 * (#1254), for the folders where the operating system's own notifications do not arrive: a network
 * share another machine writes to, or a container mount the container writes to.
 *
 * It reports what `fs.watch` would: `rename` for an entry that appeared or went away and `change` for
 * a file whose size, times or inode moved, with the path relative to the root. A directory's own
 * timestamp is not reported, since what changed inside it is. Links are recorded but never followed,
 * so a link back up the tree cannot make a poll endless. The first poll only records; it reports
 * nothing.
 *
 * A share that stops answering is not a share that was emptied. A directory or entry that cannot be
 * read for any reason but its absence keeps what the last poll saw of it, and a root that cannot be
 * read is tried again on the next poll; only a root that is gone, or that fails
 * {@link MAX_ROOT_FAILURES} polls in a row, ends the watch.
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
   * Holds what the last poll saw, or undefined before the first.
   */
  private snapshot: PollSnapshot | undefined = undefined;

  /**
   * Holds the timer for the next poll, or undefined while one runs or after closing.
   */
  private timer: NodeJS.Timeout | undefined = undefined;

  /**
   * Holds whether the watcher has been closed.
   */
  private closed: boolean = false;

  /**
   * Holds how many polls in a row have failed to read the root.
   */
  private failures: number = 0;

  /**
   * Holds whether the entry cap has been reported, so it is logged once.
   */
  private capped: boolean = false;

  /**
   * Initializes a new instance of the {@link PollingTreeWatcher} class and starts polling.
   * @param root The absolute folder to watch.
   * @param options How the watcher runs.
   * @param listener Called with each change.
   * @param onError Called once if the root is gone or keeps failing, after which nothing more is
   * reported.
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
    let current: PollSnapshot;
    try {
      current = await this.scan(this.snapshot);
    } catch (error: unknown) {
      if (this.closed) {
        return;
      }
      this.failures += 1;
      if (isGone(error) || this.failures >= MAX_ROOT_FAILURES) {
        this.closed = true;
        this.onError(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      logger.warn(
        'PollingTreeWatcher',
        `Cannot read ${this.root} (attempt ${this.failures} of ${MAX_ROOT_FAILURES}); trying again`,
        error,
      );
      this.schedule();
      return;
    }
    if (this.closed) {
      return;
    }
    this.failures = 0;
    const previous: PollSnapshot | undefined = this.snapshot;
    this.snapshot = current;
    if (previous !== undefined) {
      this.report(previous, current);
    }
    this.schedule();
  }

  /**
   * Schedules the next poll, unless the watcher has closed.
   */
  private schedule(): void {
    if (this.closed) {
      return;
    }
    this.timer = setTimeout((): void => {
      this.timer = undefined;
      void this.poll();
    }, this.options.intervalMs);
    // A poll must never be what keeps the process alive.
    this.timer.unref();
  }

  /**
   * Reports the differences between two polls. An entry that only came into or went out of view —
   * its directory was read in one poll and not the other — is not reported.
   * @param previous What the last poll saw.
   * @param current What this poll saw.
   */
  private report(previous: PollSnapshot, current: PollSnapshot): void {
    for (const [relative, entry] of current.entries) {
      if (this.closed) {
        return;
      }
      const before: PolledEntry | undefined = previous.entries.get(relative);
      if (before === undefined) {
        if (this.wasInView(relative, previous)) {
          this.listener('rename', relative);
        }
      } else if (before.directory !== entry.directory) {
        this.listener('rename', relative);
      } else if (!entry.directory && differs(before, entry)) {
        this.listener('change', relative);
      }
    }
    for (const relative of previous.entries.keys()) {
      if (this.closed) {
        return;
      }
      if (!current.entries.has(relative) && this.wasInView(relative, current)) {
        this.listener('rename', relative);
      }
    }
  }

  /**
   * Determines whether a poll was in a position to see an entry: when every file is looked at, its
   * directory was read, or is itself new to that poll (a new directory's contents are new too); when
   * only some files are, the entry was one of them.
   * @param relative The entry's path relative to the root.
   * @param snapshot The poll.
   * @returns Returns true when the poll would have seen the entry had it been there.
   */
  private wasInView(relative: string, snapshot: PollSnapshot): boolean {
    if (this.options.files !== undefined) {
      return snapshot.read.has(relative);
    }
    const parent: string = parentOf(relative);
    return snapshot.read.has(parent) || (parent !== '' && !snapshot.entries.has(parent));
  }

  /**
   * Reads every entry the watcher covers.
   * @param previous What the last poll saw, carried forward where something cannot be read.
   * @returns Returns what was seen.
   * @throws Throws when the root itself cannot be read.
   */
  private async scan(previous: PollSnapshot | undefined): Promise<PollSnapshot> {
    const snapshot: PollSnapshot = { entries: new Map<string, PolledEntry>(), read: new Set() };
    const files: (() => readonly string[]) | undefined = this.options.files;
    if (files !== undefined) {
      await fs.stat(this.root);
      snapshot.read.add('');
      await this.examineAll('', files(), previous, snapshot, []);
      for (const name of files()) {
        snapshot.read.add(name);
      }
      return snapshot;
    }
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
        if (!isGone(error)) {
          // Unreachable for now, not emptied: keep what was last seen inside it.
          carryForward(relativeDirectory, previous, snapshot);
        }
        continue;
      }
      snapshot.read.add(relativeDirectory);
      const names: readonly string[] = children.map((child: Dirent): string => child.name);
      if (!(await this.examineAll(relativeDirectory, names, previous, snapshot, pending))) {
        this.reportCap();
        // Past the cap nothing is known, so nothing is reported as gone.
        for (const [relative, entry] of previous?.entries ?? []) {
          if (!snapshot.entries.has(relative)) {
            snapshot.entries.set(relative, entry);
          }
        }
        return snapshot;
      }
    }
    return snapshot;
  }

  /**
   * Examines the named entries of a directory into a snapshot, queueing the directories to read.
   * @param relativeDirectory The directory, relative to the root.
   * @param names The entries' names.
   * @param previous What the last poll saw.
   * @param snapshot The snapshot being filled.
   * @param pending The directories still to read.
   * @returns Returns false when the entry cap was reached.
   */
  private async examineAll(
    relativeDirectory: string,
    names: readonly string[],
    previous: PollSnapshot | undefined,
    snapshot: PollSnapshot,
    pending: string[],
  ): Promise<boolean> {
    for (let start: number = 0; start < names.length; start += STAT_BATCH_SIZE) {
      if (snapshot.entries.size >= MAX_POLLED_ENTRIES) {
        return false;
      }
      const batch: readonly string[] = names.slice(start, start + STAT_BATCH_SIZE);
      const examined: readonly Examined[] = await Promise.all(
        batch.map((name: string): Promise<Examined> =>
          this.examine(relativeDirectory === '' ? name : path.join(relativeDirectory, name)),
        ),
      );
      examined.forEach((found: Examined, index: number): void => {
        const relative: string =
          relativeDirectory === '' ? batch[index] : path.join(relativeDirectory, batch[index]);
        const entry: PolledEntry | undefined =
          found === 'gone'
            ? undefined
            : found === 'failed'
              ? previous?.entries.get(relative)
              : found[1];
        if (entry === undefined) {
          return;
        }
        snapshot.entries.set(relative, entry);
        if (entry.directory && this.options.recursive && this.options.descend(relative)) {
          pending.push(relative);
        }
      });
    }
    return true;
  }

  /**
   * Reads one entry's size, times and inode, without following a link.
   * @param relative The entry's path relative to the root.
   * @returns Returns its path and what was seen; `gone` when it is not there; `failed` when it could
   * not be read for another reason.
   */
  private async examine(relative: string): Promise<Examined> {
    try {
      const stats: Stats = await fs.lstat(path.join(this.root, relative));
      return [
        relative,
        {
          directory: stats.isDirectory(),
          modified: stats.mtimeMs,
          changed: stats.ctimeMs,
          size: stats.size,
          inode: stats.ino,
        },
      ] as const;
    } catch (error: unknown) {
      return isGone(error) ? 'gone' : 'failed';
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

/**
 * Determines whether a file changed between two polls.
 * @param before What the earlier poll saw.
 * @param after What the later poll saw.
 * @returns Returns true when its size, either time or its inode moved.
 */
function differs(before: PolledEntry, after: PolledEntry): boolean {
  return (
    before.modified !== after.modified ||
    before.changed !== after.changed ||
    before.size !== after.size ||
    before.inode !== after.inode
  );
}

/**
 * Copies what the last poll saw inside a directory that cannot be read now into the new snapshot,
 * so nothing in it is reported as gone (or, when it can be read again, as new).
 * @param relativeDirectory The directory, relative to the root.
 * @param previous What the last poll saw.
 * @param snapshot The snapshot being filled.
 */
function carryForward(
  relativeDirectory: string,
  previous: PollSnapshot | undefined,
  snapshot: PollSnapshot,
): void {
  if (previous === undefined) {
    return;
  }
  const prefix: string = relativeDirectory + path.sep;
  for (const [relative, entry] of previous.entries) {
    if (relative.startsWith(prefix)) {
      snapshot.entries.set(relative, entry);
    }
  }
  for (const directory of previous.read) {
    if (directory === relativeDirectory || directory.startsWith(prefix)) {
      snapshot.read.add(directory);
    }
  }
}
