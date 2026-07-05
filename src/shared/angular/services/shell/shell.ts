import { Service } from '@angular/core';
import { Bridge } from '@shared/api/bridge';
import { ShellChannel } from '@shared/api/shell-channels';

/**
 * Renderer-side shell client: the typed wrapper around the operating-system shell IPC channels, driven
 * over the generic {@link Bridge} transport (`window.bridge`). It opens file-system paths and external
 * URLs through the main process, which validates every target before handing it to the OS.
 *
 * When the application runs outside Electron (served as a plain web app or under unit tests) the bridge
 * is absent and every operation degrades to a safe no-op.
 */
@Service()
export class Shell {
  /**
   * Holds the generic transport, or undefined when running outside Electron.
   */
  private readonly bridge: Bridge | undefined = window.bridge;

  /**
   * Opens a file-system path in the operating system's default handler (e.g. the file manager).
   * @param path The absolute path to open.
   * @returns Returns a promise that resolves once the request has been handed to the main process.
   */
  public async openPath(path: string): Promise<void> {
    await this.bridge?.invoke<string>(ShellChannel.OpenPath, path);
  }

  /**
   * Opens an external URL in the operating system's default browser. Only http, https, and mailto URLs
   * are honoured by the main process; anything else is ignored.
   * @param url The URL to open.
   * @returns Returns a promise that resolves once the request has been handed to the main process.
   */
  public async openExternal(url: string): Promise<void> {
    await this.bridge?.invoke<void>(ShellChannel.OpenExternal, url);
  }

  /**
   * Reveals a file-system path in the operating system's file manager, selecting the item within its
   * containing folder.
   * @param path The absolute path to reveal.
   * @returns Returns a promise that resolves once the request has been handed to the main process.
   */
  public async revealPath(path: string): Promise<void> {
    await this.bridge?.invoke<void>(ShellChannel.RevealPath, path);
  }
}
