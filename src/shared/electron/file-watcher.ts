import { BrowserWindow, ipcMain, IpcMainInvokeEvent } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { FileChannel } from '@shared/api/file-channels';
import { logger } from './logger';

/**
 * Specifies how long, in milliseconds, to coalesce rapid change events for a file before notifying.
 */
const DEBOUNCE_MS: number = 120;

/**
 * Tracks a watched directory: its native watcher and the reference count of each watched file name.
 */
interface WatchedDirectory {
  /**
   * Gets the native directory watcher.
   */
  readonly watcher: fs.FSWatcher;

  /**
   * Gets the reference count of each watched base file name in the directory.
   */
  readonly files: Map<string, number>;
}

/**
 * Watches files on disk on behalf of the renderer and notifies it when a watched file changes. Files
 * are watched by their parent directory (robust against editors' write-temp-then-rename saves, which
 * break per-file watches), reference-counted so the same file can be watched from several places, and
 * debounced. One instance is owned by the main process.
 */
export class FileWatcher {
  /**
   * Holds the function used to resolve the window change notifications are sent to.
   */
  private readonly windowGetter: () => BrowserWindow | null;

  /**
   * Holds the watched directories, keyed by absolute directory path.
   */
  private readonly directories: Map<string, WatchedDirectory> = new Map<string, WatchedDirectory>();

  /**
   * Holds the pending debounce timers, keyed by absolute file path.
   */
  private readonly timers: Map<string, NodeJS.Timeout> = new Map<string, NodeJS.Timeout>();

  /**
   * Initializes a new instance of the {@link FileWatcher} class.
   * @param windowGetter A function that returns the window change notifications are sent to.
   */
  public constructor(windowGetter: () => BrowserWindow | null) {
    this.windowGetter = windowGetter;
  }

  /**
   * Registers the file-watch IPC handlers.
   */
  public register(): void {
    logger.info('FileWatcher', 'Registering file-watch IPC handlers');
    ipcMain.handle(FileChannel.Watch, (_event: IpcMainInvokeEvent, target: unknown): void => {
      logger.trace('FileWatcher', `Watch requested for ${String(target)}`);
      if (typeof target === 'string') {
        this.watch(target);
      }
    });
    ipcMain.handle(FileChannel.Unwatch, (_event: IpcMainInvokeEvent, target: unknown): void => {
      logger.trace('FileWatcher', `Unwatch requested for ${String(target)}`);
      if (typeof target === 'string') {
        this.unwatch(target);
      }
    });
  }

  /**
   * Closes every directory watcher and clears pending timers. Called on application shutdown.
   */
  public disposeAll(): void {
    logger.info(
      'FileWatcher',
      `Disposing all file watchers (${this.directories.size} directories)`,
    );
    for (const directory of this.directories.values()) {
      directory.watcher.close();
    }
    this.directories.clear();
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }

  /**
   * Begins watching a file (reference-counted), opening a watcher on its directory if needed.
   * @param target The absolute file path to watch.
   */
  private watch(target: string): void {
    const directoryPath: string = path.dirname(target);
    const name: string = path.basename(target);
    let directory: WatchedDirectory | undefined = this.directories.get(directoryPath);
    if (directory === undefined) {
      try {
        const watcher: fs.FSWatcher = fs.watch(
          directoryPath,
          (_eventType: fs.WatchEventType, filename: string | Buffer | null): void =>
            this.onDirectoryEvent(directoryPath, filename),
        );
        directory = { watcher, files: new Map<string, number>() };
        this.directories.set(directoryPath, directory);
        logger.info('FileWatcher', `Started watching directory ${directoryPath}`);
      } catch (error: unknown) {
        logger.error('FileWatcher', `Cannot watch ${directoryPath}`, error);
        return;
      }
    }
    directory.files.set(name, (directory.files.get(name) ?? 0) + 1);
    logger.debug('FileWatcher', `Watching file ${name} in ${directoryPath}`);
  }

  /**
   * Stops watching a file (reference-counted), closing the directory watcher when it has no files.
   * @param target The absolute file path to stop watching.
   */
  private unwatch(target: string): void {
    const directoryPath: string = path.dirname(target);
    const name: string = path.basename(target);
    const directory: WatchedDirectory | undefined = this.directories.get(directoryPath);
    if (directory === undefined) {
      return;
    }
    const count: number = (directory.files.get(name) ?? 0) - 1;
    if (count > 0) {
      directory.files.set(name, count);
    } else {
      directory.files.delete(name);
    }
    if (directory.files.size === 0) {
      directory.watcher.close();
      this.directories.delete(directoryPath);
      logger.info('FileWatcher', `Stopped watching directory ${directoryPath} (no files left)`);
    }
  }

  /**
   * Handles a native directory event, debouncing per file and notifying only for watched files that
   * still exist (modifications, not deletions).
   * @param directoryPath The absolute directory path the event occurred in.
   * @param filename The changed file's name, or null when the platform did not provide it.
   */
  private onDirectoryEvent(directoryPath: string, filename: string | Buffer | null): void {
    if (typeof filename !== 'string') {
      return;
    }
    if (this.directories.get(directoryPath)?.files.has(filename) !== true) {
      return;
    }
    const target: string = path.join(directoryPath, filename);
    const existing: NodeJS.Timeout | undefined = this.timers.get(target);
    if (existing !== undefined) {
      clearTimeout(existing);
    }
    this.timers.set(
      target,
      setTimeout((): void => {
        this.timers.delete(target);
        if (fs.existsSync(target)) {
          this.send(target);
        }
      }, DEBOUNCE_MS),
    );
  }

  /**
   * Sends a change notification to the renderer window, if one is available and not destroyed.
   * @param target The absolute path of the file that changed.
   */
  private send(target: string): void {
    const window: BrowserWindow | null = this.windowGetter();
    if (window !== null && !window.isDestroyed()) {
      window.webContents.send(FileChannel.Changed, target);
    }
  }
}
