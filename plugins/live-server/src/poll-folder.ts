// Polls a folder for changes, for the folders Studio says the platform's watching misses (#1254).
import { promises as fs } from 'node:fs';
import type { Dirent, Stats } from 'node:fs';
import * as path from 'node:path';

/**
 * The most files one poll keeps track of. A site is a handful of pages, styles and scripts; a folder
 * with more than this is not one a browser is showing all of, and polling it all over a share costs
 * more than the reloads are worth.
 */
export const MAX_POLLED_FILES: number = 20_000;

/**
 * The shortest and longest polling interval accepted, in milliseconds, whatever Studio asked for.
 */
const INTERVAL_RANGE_MS: readonly [number, number] = [250, 60_000];

/**
 * A running watch on a folder, by the platform or by polling.
 */
export interface FolderWatcher {
  /**
   * Stops watching.
   */
  close(): void;
}

/**
 * Clamps a polling interval Studio asked for into the range accepted.
 * @param requested The interval asked for, untrusted.
 * @returns Returns the interval in milliseconds, or undefined when none was asked for.
 */
export function pollIntervalOf(requested: unknown): number | undefined {
  if (typeof requested !== 'number' || !Number.isFinite(requested)) {
    return undefined;
  }
  const [shortest, longest]: readonly [number, number] = INTERVAL_RANGE_MS;
  return Math.min(longest, Math.max(shortest, Math.round(requested)));
}

/**
 * Determines whether a poll reads a folder: not a dot-folder such as `.git`, and not a dependency
 * folder, whose changes a page never shows.
 * @param name The folder's name.
 * @returns Returns true when it is read.
 */
function isPolledFolder(name: string): boolean {
  return !name.startsWith('.') && name !== 'node_modules';
}

/**
 * Polls a folder and everything under it, calling back with the path, relative to it, of each file
 * that appeared, changed or went away since the previous poll. The first poll only records.
 */
export class FolderPoll implements FolderWatcher {
  /**
   * Holds what the last poll saw: each file's size and modification time, by relative path.
   */
  private snapshot: Map<string, string> | undefined = undefined;

  /**
   * Holds the timer for the next poll.
   */
  private timer: NodeJS.Timeout | undefined = undefined;

  /**
   * Holds whether polling has stopped.
   */
  private closed: boolean = false;

  /**
   * Starts polling.
   * @param root The folder.
   * @param intervalMs How long to wait between polls.
   * @param onChange Called with each changed file's path relative to the folder.
   */
  public constructor(
    private readonly root: string,
    private readonly intervalMs: number,
    private readonly onChange: (relative: string) => void,
  ) {
    void this.poll();
  }

  /**
   * Stops polling.
   */
  public close(): void {
    this.closed = true;
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  /**
   * Reads the folder, reports what changed, and schedules the next poll.
   * @returns Returns a promise that resolves once the poll is done.
   */
  private async poll(): Promise<void> {
    const current: Map<string, string> = await this.scan();
    if (this.closed) {
      return;
    }
    const previous: Map<string, string> | undefined = this.snapshot;
    this.snapshot = current;
    if (previous !== undefined) {
      for (const [relative, signature] of current) {
        if (previous.get(relative) !== signature) {
          this.onChange(relative);
        }
      }
      for (const relative of previous.keys()) {
        if (!current.has(relative)) {
          this.onChange(relative);
        }
      }
    }
    this.timer = setTimeout((): void => {
      this.timer = undefined;
      void this.poll();
    }, this.intervalMs);
    this.timer.unref();
  }

  /**
   * Reads every file the poll covers, without following links.
   * @returns Returns each file's size and modification time, by path relative to the folder.
   */
  private async scan(): Promise<Map<string, string>> {
    const files: Map<string, string> = new Map<string, string>();
    const folders: string[] = [''];
    for (let next: number = 0; next < folders.length && !this.closed; next++) {
      const folder: string = folders[next];
      let entries: Dirent[];
      try {
        entries = await fs.readdir(path.join(this.root, folder), { withFileTypes: true });
      } catch {
        // A folder that went away, or one that cannot be read, has nothing in it to show.
        continue;
      }
      for (const entry of entries) {
        const relative: string = folder === '' ? entry.name : path.join(folder, entry.name);
        if (entry.isDirectory()) {
          if (isPolledFolder(entry.name)) {
            folders.push(relative);
          }
          continue;
        }
        if (files.size >= MAX_POLLED_FILES) {
          return files;
        }
        try {
          const stats: Stats = await fs.lstat(path.join(this.root, relative));
          files.set(relative, `${stats.size}:${stats.mtimeMs}`);
        } catch {
          // Gone since the folder was read; the next poll reports it as gone if it was there before.
        }
      }
    }
    return files;
  }
}
