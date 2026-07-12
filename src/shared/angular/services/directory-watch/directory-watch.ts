import { Service } from '@angular/core';
import { Bridge } from '@shared/api/bridge';
import { DirectoryChangeEvent, FileChannel } from '@shared/api/file-channels';

/**
 * A general, root directory-watch service: the single place tree-shaped consumers (the explorers, the
 * source-control view) register to be notified when entries anywhere beneath a directory change on
 * disk. It reference-counts watches per root (so the same root watched from several places opens one
 * OS watcher), bridges to the main-process watcher, and fans each coalesced change burst out to the
 * root's subscribers. Knows nothing about what its subscribers show — anything holding a directory
 * tree can use it.
 */
@Service()
export class DirectoryWatch {
  /**
   * Holds the generic transport, or undefined when running outside Electron.
   */
  private readonly bridge: Bridge | undefined = window.bridge;

  /**
   * Holds the subscribers for each watched root.
   */
  private readonly watchers: Map<string, Set<(event: DirectoryChangeEvent) => void>> = new Map<
    string,
    Set<(event: DirectoryChangeEvent) => void>
  >();

  /**
   * Initializes a new instance of the {@link DirectoryWatch} class, subscribing to change
   * notifications.
   */
  public constructor() {
    this.bridge?.on(FileChannel.DirectoryChanged, (...args: unknown[]): void => {
      this.onChanged(args[0] as DirectoryChangeEvent);
    });
  }

  /**
   * Watches a directory tree, invoking the callback with each coalesced change burst beneath it.
   * @param root The absolute directory path to watch.
   * @param onChange Receives each change burst.
   * @returns Returns a function that stops this subscription.
   */
  public watch(root: string, onChange: (event: DirectoryChangeEvent) => void): () => void {
    let callbacks: Set<(event: DirectoryChangeEvent) => void> | undefined = this.watchers.get(root);
    if (callbacks === undefined) {
      callbacks = new Set<(event: DirectoryChangeEvent) => void>();
      this.watchers.set(root, callbacks);
      void this.bridge?.invoke(FileChannel.WatchDirectory, root);
    }
    callbacks.add(onChange);
    return (): void => this.unwatch(root, onChange);
  }

  /**
   * Removes a subscription, stopping the OS watch when the root has no subscribers left.
   * @param root The watched root.
   * @param onChange The callback to remove.
   */
  private unwatch(root: string, onChange: (event: DirectoryChangeEvent) => void): void {
    const callbacks: Set<(event: DirectoryChangeEvent) => void> | undefined =
      this.watchers.get(root);
    if (callbacks === undefined) {
      return;
    }
    callbacks.delete(onChange);
    if (callbacks.size === 0) {
      this.watchers.delete(root);
      void this.bridge?.invoke(FileChannel.UnwatchDirectory, root);
    }
  }

  /**
   * Notifies a changed root's subscribers.
   * @param event The change burst received from the main process.
   */
  private onChanged(event: DirectoryChangeEvent): void {
    const callbacks: Set<(event: DirectoryChangeEvent) => void> | undefined = this.watchers.get(
      event.root,
    );
    if (callbacks === undefined) {
      return;
    }
    for (const callback of callbacks) {
      callback(event);
    }
  }
}
