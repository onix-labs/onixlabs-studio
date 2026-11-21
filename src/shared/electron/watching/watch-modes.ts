import { promises as fs } from 'node:fs';
import {
  DEFAULT_POLLING_INTERVAL,
  findPollingFolder,
  isCaseInsensitivePlatform,
  sanitizePollingFolders,
  sanitizePollingInterval,
} from '@shared/api/polling-folders';
import type { MetadataPolicies } from '../directory-watch-filter';
import { logger } from '../logger';

/**
 * Resolves a path's links, answering undefined when it cannot be resolved.
 */
export type RealPathResolver = (target: string) => Promise<string | undefined>;

/**
 * Decides, for every file watcher Studio runs, whether its root is watched natively or polled (#1254).
 *
 * Native watching is the default everywhere. A root inside one of the polled folders (Settings ›
 * Workspaces › File Watching) is polled instead, because the operating system misses the changes made
 * on a network share by another machine, or inside a container mount by the container. A folder and a
 * root match by the paths as written and by their real paths, so a workspace opened through a link to
 * a share is polled as the share is, and a share listed by a link is honoured for the folder it names.
 *
 * One instance is owned by the main process and shared by the directory, file and language-server
 * watchers and the live server, which re-decide when the list changes.
 */
export class WatchModes {
  /**
   * Holds the polled folders as configured.
   */
  private folders: readonly string[] = [];

  /**
   * Holds the configured folders' real paths, filled in as they resolve.
   */
  private realFolders: readonly string[] = [];

  /**
   * Holds how often a polled root is checked, in milliseconds.
   */
  private intervalMs: number = DEFAULT_POLLING_INTERVAL * 1000;

  /**
   * Holds the number of the latest update, so a slow resolution of an older list is discarded.
   */
  private generation: number = 0;

  /**
   * Holds the callbacks told when the decision may have changed.
   */
  private readonly listeners: Set<() => void> = new Set<() => void>();

  /**
   * Holds whether paths are compared without regard to case.
   */
  private readonly caseInsensitive: boolean;

  /**
   * Holds how links are resolved.
   */
  private readonly resolveRealPath: RealPathResolver;

  /**
   * Gets the version-control metadata policies, which decide what a poll need not read.
   */
  public readonly metadata: () => MetadataPolicies;

  /**
   * Initializes a new instance of the {@link WatchModes} class, with no folder polled.
   * @param metadata Gets the version-control metadata policies; none by default.
   * @param caseInsensitive Whether paths are compared without regard to case; the platform's
   * convention by default.
   * @param resolveRealPath How links are resolved; the file system's own by default.
   */
  public constructor(
    metadata: () => MetadataPolicies = (): MetadataPolicies => new Map<string, readonly string[]>(),
    caseInsensitive: boolean = isCaseInsensitivePlatform(process.platform),
    resolveRealPath: RealPathResolver = realPathOf,
  ) {
    this.metadata = metadata;
    this.caseInsensitive = caseInsensitive;
    this.resolveRealPath = resolveRealPath;
  }

  /**
   * Gets whether any folder is polled, so a watcher can skip resolving its root's links when none is.
   */
  public get hasFolders(): boolean {
    return this.folders.length > 0;
  }

  /**
   * Replaces the polled folders and the interval, telling every watcher once the folders' real paths
   * are known. A change that changes nothing tells nobody.
   * @param folders The polled folders, untrusted.
   * @param intervalSeconds How often a polled root is checked, in seconds, untrusted.
   * @returns Returns a promise that resolves once the watchers have been told.
   */
  public async update(folders: unknown, intervalSeconds: unknown): Promise<void> {
    const next: readonly string[] = sanitizePollingFolders(folders);
    const intervalMs: number = sanitizePollingInterval(intervalSeconds) * 1000;
    if (
      intervalMs === this.intervalMs &&
      next.length === this.folders.length &&
      next.every((folder: string, index: number): boolean => folder === this.folders[index])
    ) {
      return;
    }
    const generation: number = ++this.generation;
    this.folders = next;
    this.intervalMs = intervalMs;
    this.realFolders = [];
    logger.info(
      'WatchModes',
      next.length === 0
        ? 'No folder is polled; every watcher is native'
        : `Polling ${next.length} folder(s) every ${intervalMs} ms`,
    );
    // What is known straight away is acted on straight away; links are resolved after.
    this.notify();
    const resolved: readonly (string | undefined)[] = await Promise.all(
      next.map((folder: string): Promise<string | undefined> => this.resolveRealPath(folder)),
    );
    if (generation !== this.generation) {
      return;
    }
    this.realFolders = resolved.filter(
      (real: string | undefined, index: number): real is string =>
        real !== undefined && real !== next[index],
    );
    if (this.realFolders.length > 0) {
      this.notify();
    }
  }

  /**
   * Decides from the path as written, without touching the disk, whether a root is polled.
   * @param root The watcher's absolute root.
   * @returns Returns the polling interval in milliseconds, or undefined to watch natively.
   */
  public pollIntervalFor(root: string): number | undefined {
    return this.matches(root) ? this.intervalMs : undefined;
  }

  /**
   * Decides whether a root is polled, following its links as well.
   * @param root The watcher's absolute root.
   * @returns Returns the polling interval in milliseconds, or undefined to watch natively.
   */
  public async resolvePollInterval(root: string): Promise<number | undefined> {
    if (this.folders.length === 0) {
      return undefined;
    }
    if (this.matches(root)) {
      return this.intervalMs;
    }
    const real: string | undefined = await this.resolveRealPath(root);
    return real !== undefined && real !== root && this.matches(real) ? this.intervalMs : undefined;
  }

  /**
   * Subscribes to changes that may change a decision.
   * @param listener Called after each change.
   * @returns Returns a function that unsubscribes.
   */
  public onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return (): void => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Determines whether a path lies inside a polled folder, as configured or as resolved.
   * @param target The absolute path.
   * @returns Returns true when it does.
   */
  private matches(target: string): boolean {
    return (
      findPollingFolder(target, this.folders, this.caseInsensitive) !== undefined ||
      findPollingFolder(target, this.realFolders, this.caseInsensitive) !== undefined
    );
  }

  /**
   * Tells every subscriber that a decision may have changed.
   */
  private notify(): void {
    for (const listener of [...this.listeners]) {
      listener();
    }
  }
}

/**
 * Resolves a path's links with the file system.
 * @param target The absolute path.
 * @returns Returns the real path, or undefined when the path cannot be resolved (it does not exist,
 * or a share is not mounted).
 */
async function realPathOf(target: string): Promise<string | undefined> {
  try {
    return await fs.realpath(target);
  } catch {
    return undefined;
  }
}
