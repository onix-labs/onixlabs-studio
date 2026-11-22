import * as fs from 'node:fs';
import { shouldPollInside } from '../directory-watch-filter';
import { logger } from '../logger';
import { PollingTreeWatcher } from './polling-tree-watcher';
import type {
  PollDescent,
  TreeWatch,
  TreeWatchErrorListener,
  TreeWatchListener,
} from './tree-watch';
import type { WatchModes } from './watch-modes';

/**
 * Describes what an adaptive watch watches.
 */
export interface AdaptiveTreeWatchOptions {
  /**
   * Gets whether everything beneath the root is watched, rather than only its own entries.
   */
  readonly recursive: boolean;

  /**
   * Gets the policy deciding whether the root is polled.
   */
  readonly modes: WatchModes;

  /**
   * Gets which directories a poll reads, when it should differ from the default (everything but
   * build outputs, dependency caches and the version-control bookkeeping nothing listens to): a
   * language server that registered for files in `obj` needs `obj` read.
   */
  readonly descend?: PollDescent;

  /**
   * Gets, for a watch of one folder's own entries, the only names the watcher cares about. A poll
   * then examines just those instead of listing the folder and examining everything in it.
   */
  readonly files?: () => readonly string[];
}

/**
 * Watches a folder the way {@link WatchModes} says to (#1254): natively, which is the default, or by
 * polling when the folder lies inside a polled folder. It is what every watcher in the main process
 * opens instead of calling `fs.watch` itself.
 *
 * The decision is made at once from the path as written, so a native watch starts without waiting on
 * the disk; when any folder is polled, the root's links are then followed and the watch switches to
 * polling if they lead inside one. It switches again whenever the polled folders change. A switch may
 * have missed something in between, so it is reported as a change whose path is withheld, which tells
 * a subscriber to look again at everything.
 */
export class AdaptiveTreeWatch implements TreeWatch {
  /**
   * Holds the watched root.
   */
  private readonly root: string;

  /**
   * Holds what is watched and the policy deciding how.
   */
  private readonly options: AdaptiveTreeWatchOptions;

  /**
   * Holds the callback that receives each change.
   */
  private readonly listener: TreeWatchListener;

  /**
   * Holds the callback told when watching fails.
   */
  private readonly onError: TreeWatchErrorListener;

  /**
   * Holds the function that stops listening for policy changes.
   */
  private readonly unsubscribe: () => void;

  /**
   * Holds the watch running now.
   */
  private inner: TreeWatch;

  /**
   * Holds the polling interval in force, in milliseconds, or undefined while watching natively.
   */
  private interval: number | undefined;

  /**
   * Holds the number of the latest reconsideration, so a slow one that a newer one overtook is ignored.
   */
  private decision: number = 0;

  /**
   * Holds whether the watch has stopped.
   */
  private closed: boolean = false;

  /**
   * Initializes a new instance of the {@link AdaptiveTreeWatch} class and starts watching.
   * @param root The absolute folder to watch.
   * @param options What is watched and the policy deciding how.
   * @param listener Called with each change.
   * @param onError Called once if watching fails, after which nothing more is reported.
   * @throws Throws when the operating system refuses to watch the folder natively, as `fs.watch` does.
   */
  public constructor(
    root: string,
    options: AdaptiveTreeWatchOptions,
    listener: TreeWatchListener,
    onError: TreeWatchErrorListener,
  ) {
    this.root = root;
    this.options = options;
    this.listener = listener;
    this.onError = onError;
    this.interval = options.modes.pollIntervalFor(root);
    this.inner = this.open(this.interval);
    if (this.interval !== undefined) {
      logger.info('AdaptiveTreeWatch', `Polling ${root} every ${this.interval} ms`);
    }
    this.unsubscribe = options.modes.onChange((): void => void this.reconsider());
    if (this.interval === undefined && options.modes.hasFolders) {
      void this.reconsider();
    }
  }

  /**
   * Gets whether the folder is being polled rather than watched natively.
   */
  public get polling(): boolean {
    return this.interval !== undefined;
  }

  /**
   * Stops watching.
   */
  public close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.unsubscribe();
    this.inner.close();
  }

  /**
   * Opens the watch a decision calls for.
   * @param interval The polling interval in milliseconds, or undefined to watch natively.
   * @returns Returns the running watch.
   */
  private open(interval: number | undefined): TreeWatch {
    if (interval !== undefined) {
      const onEvent: TreeWatchListener = (
        eventType: fs.WatchEventType,
        filename: string | null,
      ): void => this.forward(eventType, filename);
      const onError: TreeWatchErrorListener = (error: Error): void => this.fail(error);
      const files: (() => readonly string[]) | undefined = this.options.files;
      if (files !== undefined && !this.options.recursive) {
        return new PollingTreeWatcher(
          this.root,
          { intervalMs: interval, recursive: false, descend: (): boolean => false, files },
          onEvent,
          onError,
        );
      }
      const descend: PollDescent =
        this.options.descend ??
        ((relative: string): boolean => shouldPollInside(relative, this.options.modes.metadata()));
      // One poll per folder, shared with every other watcher on it.
      return this.options.modes.polls.subscribe(
        this.root,
        interval,
        this.options.recursive,
        descend,
        onEvent,
        onError,
      );
    }
    const onEvent: (eventType: fs.WatchEventType, filename: string | Buffer | null) => void = (
      eventType: fs.WatchEventType,
      filename: string | Buffer | null,
    ): void => this.forward(eventType, typeof filename === 'string' ? filename : null);
    // The two-argument form for a single folder, as `fs.watch` is most often called.
    const watcher: fs.FSWatcher = this.options.recursive
      ? fs.watch(this.root, { recursive: true }, onEvent)
      : fs.watch(this.root, onEvent);
    // An `error` event with no listener is an uncaught exception in the main process.
    watcher.on('error', (error: Error): void => this.fail(error));
    return watcher;
  }

  /**
   * Passes an event on, unless the watch has stopped.
   * @param eventType The kind of change.
   * @param filename The changed entry's path relative to the root, or null when withheld.
   */
  private forward(eventType: fs.WatchEventType, filename: string | null): void {
    if (!this.closed) {
      this.listener(eventType, filename);
    }
  }

  /**
   * Stops watching after a failure and reports it.
   * @param error The failure.
   */
  private fail(error: Error): void {
    if (this.closed) {
      return;
    }
    this.close();
    this.onError(error);
  }

  /**
   * Decides again, following the root's links, and switches between native watching and polling when
   * the decision changed.
   * @returns Returns a promise that resolves once any switch is made.
   */
  private async reconsider(): Promise<void> {
    const decision: number = ++this.decision;
    const interval: number | undefined = await this.options.modes.resolvePollInterval(this.root);
    if (this.closed || decision !== this.decision || interval === this.interval) {
      return;
    }
    const previous: TreeWatch = this.inner;
    previous.close();
    try {
      this.inner = this.open(interval);
    } catch (error: unknown) {
      this.closed = true;
      this.unsubscribe();
      this.onError(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    this.interval = interval;
    logger.info(
      'AdaptiveTreeWatch',
      interval === undefined
        ? `Watching ${this.root} natively`
        : `Polling ${this.root} every ${interval} ms`,
    );
    this.listener('rename', null);
  }
}
