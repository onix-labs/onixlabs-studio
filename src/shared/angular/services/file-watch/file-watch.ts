import { inject, Service } from '@angular/core';
import { Bridge } from '@shared/api/bridge';
import { FileChannel, FileInfo } from '@shared/api/file-channels';
import { FileSystem } from '../file-system/file-system';

/**
 * Tracks the subscribers watching one file path.
 */
interface PathWatchers {
  /**
   * Gets the callbacks invoked when the file changes, each receiving the freshly-read file.
   */
  readonly callbacks: Set<(info: FileInfo) => void>;
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
    let entry: PathWatchers | undefined = this.watchers.get(path);
    if (entry === undefined) {
      entry = { callbacks: new Set<(info: FileInfo) => void>() };
      this.watchers.set(path, entry);
      void this.bridge?.invoke(FileChannel.Watch, path);
    }
    entry.callbacks.add(onChange);
    return (): void => this.unwatch(path, onChange);
  }

  /**
   * Removes a subscription, stopping the OS watch when the path has no subscribers left.
   * @param path The watched path.
   * @param onChange The callback to remove.
   */
  private unwatch(path: string, onChange: (info: FileInfo) => void): void {
    const entry: PathWatchers | undefined = this.watchers.get(path);
    if (entry === undefined) {
      return;
    }
    entry.callbacks.delete(onChange);
    if (entry.callbacks.size === 0) {
      this.watchers.delete(path);
      void this.bridge?.invoke(FileChannel.Unwatch, path);
    }
  }

  /**
   * Re-reads a changed file once and notifies its subscribers.
   * @param path The path that changed.
   */
  private async onChanged(path: string): Promise<void> {
    const entry: PathWatchers | undefined = this.watchers.get(path);
    if (entry === undefined) {
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
