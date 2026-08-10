import { inject, Service } from '@angular/core';
import { Bridge } from '@shared/api/bridge';
import { FileChannel, FileInfo } from '@shared/api/file-channels';
import { Log } from '@shared/angular/services/log/log';
import { FileSystem } from '../file-system/file-system';

/**
 * Tracks the subscribers watching one file path.
 */
interface PathWatchers {
  /**
   * Gets the callbacks invoked when the file changes, each receiving the freshly-read file.
   */
  readonly callbacks: Set<(info: FileInfo) => void>;

  /**
   * Gets the callbacks invoked when the file changes that want only the notification, not the file's
   * text. Used by consumers of non-text files (the binary editor), whose bytes must not be read as
   * text and who re-fetch what they need themselves.
   */
  readonly pathCallbacks: Set<() => void>;
}

/**
 * A general, root file-watch service: the single place open documents register to be notified when
 * their file changes on disk. It reference-counts watches per path (so the same file watched from
 * several places opens one OS watcher), bridges to the main-process watcher, re-reads the file once
 * per change, and fans the result out to subscribers. Knows nothing about documents — anything that
 * holds an open file can use it.
 */
@Service()
export class FileWatch {
  /**
   * Holds the file-system bridge used to re-read changed files.
   */
  private readonly fileSystem: FileSystem = inject(FileSystem);

  /**
   * Holds the generic transport, or undefined when running outside Electron.
   */
  private readonly bridge: Bridge | undefined = window.bridge;

  /**
   * Holds the subscribers for each watched path.
   */
  private readonly watchers: Map<string, PathWatchers> = new Map<string, PathWatchers>();

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Initializes a new instance of the {@link FileWatch} class, subscribing to change notifications.
   */
  public constructor() {
    this.bridge?.on(FileChannel.Changed, (...args: unknown[]): void => {
      void this.onChanged(args[0] as string);
    });
  }

  /**
   * Watches a file, invoking the callback with the re-read file whenever it changes on disk.
   * @param path The absolute path to watch.
   * @param onChange Receives the freshly-read file on each change.
   * @returns Returns a function that stops this subscription.
   */
  public watch(path: string, onChange: (info: FileInfo) => void): () => void {
    const entry: PathWatchers = this.ensureWatched(path);
    entry.callbacks.add(onChange);
    return (): void => {
      entry.callbacks.delete(onChange);
      this.releaseIfUnused(path);
    };
  }

  /**
   * Watches a file, invoking the callback whenever it changes on disk without reading its contents.
   * For consumers of non-text files (the binary editor), whose bytes must not be read as text and who
   * re-fetch what they need themselves.
   * @param path The absolute path to watch.
   * @param onChange Invoked on each change.
   * @returns Returns a function that stops this subscription.
   */
  public watchPath(path: string, onChange: () => void): () => void {
    const entry: PathWatchers = this.ensureWatched(path);
    entry.pathCallbacks.add(onChange);
    return (): void => {
      entry.pathCallbacks.delete(onChange);
      this.releaseIfUnused(path);
    };
  }

  /**
   * Gets the subscriber entry for a path, starting the OS watch when it is the path's first.
   * @param path The absolute path to watch.
   * @returns Returns the path's subscriber entry.
   */
  private ensureWatched(path: string): PathWatchers {
    let entry: PathWatchers | undefined = this.watchers.get(path);
    if (entry === undefined) {
      entry = {
        callbacks: new Set<(info: FileInfo) => void>(),
        pathCallbacks: new Set<() => void>(),
      };
      this.watchers.set(path, entry);
      void this.bridge?.invoke(FileChannel.Watch, path);
      this.log.debug('FileWatch', 'Started watching file', path);
    }
    return entry;
  }

  /**
   * Stops the OS watch for a path once it has no subscribers of either kind left.
   * @param path The watched path.
   */
  private releaseIfUnused(path: string): void {
    const entry: PathWatchers | undefined = this.watchers.get(path);
    if (entry === undefined || entry.callbacks.size > 0 || entry.pathCallbacks.size > 0) {
      return;
    }
    this.watchers.delete(path);
    void this.bridge?.invoke(FileChannel.Unwatch, path);
    this.log.debug('FileWatch', 'Stopped watching file', path);
  }

  /**
   * Notifies a changed path's subscribers, re-reading the file once when any subscriber wants its
   * contents.
   * @param path The path that changed.
   */
  private async onChanged(path: string): Promise<void> {
    const entry: PathWatchers | undefined = this.watchers.get(path);
    if (entry === undefined) {
      return;
    }
    this.log.trace('FileWatch', 'File changed on disk', path);
    for (const callback of entry.pathCallbacks) {
      callback();
    }
    if (entry.callbacks.size === 0) {
      return;
    }
    const info: FileInfo | null = await this.fileSystem.read(path);
    if (info === null) {
      return;
    }
    for (const callback of entry.callbacks) {
      callback(info);
    }
  }
}
