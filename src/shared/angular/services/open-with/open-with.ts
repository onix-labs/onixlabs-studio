import { inject, OnDestroy, Service } from '@angular/core';
import { AppChannel } from '@shared/api/app-channels';
import { Bridge } from '@shared/api/bridge';
import { FileOpener } from '@shared/angular/services/file-opener/file-opener';

/**
 * Opens the files the operating system asks the application to open (a Finder/Explorer double-click
 * or "Open with" on an associated file type). The main process vouches for each path and either
 * queues it (when it arrived before the renderer was listening — launch arguments, or an open-file
 * event during startup) or pushes it directly. On startup this service drains the queued paths and
 * then listens for pushes, routing every path through {@link FileOpener.reopenFile}, which picks the
 * right editor tab by file type (markdown, code, or binary) and works from a cold start with no
 * workspace open. Outside Electron the bridge is absent and the service is a no-op.
 */
@Service()
export class OpenWith implements OnDestroy {
  /**
   * Holds the opener that routes a path to the right editor tab.
   */
  private readonly fileOpener: FileOpener = inject(FileOpener);

  /**
   * Holds the generic transport, or undefined when running outside Electron.
   */
  private readonly bridge: Bridge | undefined = window.bridge;

  /**
   * Holds the disposer for the open-path subscription, or null when not subscribed.
   */
  private disposer: (() => void) | null = null;

  /**
   * Initializes a new instance of the {@link OpenWith} class: subscribes to open-path pushes, then
   * drains the paths that arrived before the renderer was ready. Subscribing first guarantees no
   * push can slip between the drain and the subscription.
   */
  public constructor() {
    if (this.bridge === undefined) {
      return;
    }
    this.disposer = this.bridge.on(AppChannel.OpenPath, (...args: unknown[]): void => {
      this.open(args[0]);
    });
    void this.bridge
      .invoke<readonly unknown[]>(AppChannel.TakePendingOpenPaths)
      .then((paths: readonly unknown[]): void => {
        for (const path of paths ?? []) {
          this.open(path);
        }
      });
  }

  /**
   * Unsubscribes from open-path pushes.
   */
  public ngOnDestroy(): void {
    this.disposer?.();
    this.disposer = null;
  }

  /**
   * Opens one OS-supplied path in the editor its file type routes to, ignoring malformed payloads.
   * @param path The candidate path payload from the main process.
   */
  private open(path: unknown): void {
    if (typeof path !== 'string' || path.length === 0) {
      return;
    }
    void this.fileOpener.reopenFile(path);
  }
}
