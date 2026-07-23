import { Service } from '@angular/core';
import { Bridge } from '@shared/api/bridge';
import { WindowChannel } from '@shared/api/window-channels';

/**
 * Represents the renderer-side wrapper around the app-shell chrome: window controls and the host
 * platform. Window operations are driven over the generic {@link Bridge} transport (`window.bridge`);
 * `platform` is read from the static {@link Window.host} object.
 *
 * When the application runs outside Electron (served as a plain web app or under unit tests) the
 * bridge and host are absent and the window operations become no-ops.
 */
@Service()
export class Studio {
  /**
   * Holds the generic transport, or undefined when running outside Electron.
   */
  private readonly bridge: Bridge | undefined = window.bridge;

  /**
   * Gets the operating system platform, or 'browser' when running outside Electron.
   */
  public readonly platform: string = window.host?.platform ?? 'browser';

  /**
   * Gets a value indicating whether custom window controls should be shown. They are shown on
   * Windows and Linux, which lack the native inset window controls that macOS provides.
   */
  public readonly showWindowControls: boolean =
    this.platform === 'win32' || this.platform === 'linux';

  /**
   * Minimizes the application window.
   */
  public minimizeWindow(): void {
    this.bridge?.send(WindowChannel.Minimize);
  }

  /**
   * Toggles the application window between its maximized and restored states.
   */
  public toggleMaximizeWindow(): void {
    this.bridge?.send(WindowChannel.ToggleMaximize);
  }

  /**
   * Closes the application window.
   */
  public closeWindow(): void {
    this.bridge?.send(WindowChannel.Close);
  }

  /**
   * Sets whether the application window may be moved by dragging its draggable regions.
   * @param movable True to allow the window to be moved; false to lock it in place.
   */
  public setWindowMovable(movable: boolean): void {
    this.bridge?.send(WindowChannel.SetMovable, movable);
  }

  /**
   * Asks the main process to open a pop-out window carrying the given parameters.
   * @param params The pop-out parameters (surface selector, title, …).
   * @returns Returns the pop-out's window identifier, or null when the request was rejected (or
   * running outside Electron).
   */
  public openPopoutWindow(params: Readonly<Record<string, string>>): Promise<number | null> {
    return (
      this.bridge?.invoke<number | null>(WindowChannel.OpenPopout, params) ?? Promise.resolve(null)
    );
  }

  /**
   * Closes a pop-out window.
   * @param id The pop-out's window identifier.
   * @returns Returns true when a live pop-out with that identifier was told to close.
   */
  public closePopoutWindow(id: number): Promise<boolean> {
    return this.bridge?.invoke<boolean>(WindowChannel.ClosePopout, id) ?? Promise.resolve(false);
  }

  /**
   * Brings a pop-out window to the front, restoring it first when minimized.
   * @param id The pop-out's window identifier.
   * @returns Returns true when a live pop-out with that identifier was focused.
   */
  public focusPopoutWindow(id: number): Promise<boolean> {
    return this.bridge?.invoke<boolean>(WindowChannel.FocusPopout, id) ?? Promise.resolve(false);
  }

  /**
   * Subscribes to pop-out-closed notifications (delivered to the main window).
   * @param listener Receives the closed pop-out's window identifier.
   * @returns Returns a function that removes the listener.
   */
  public onPopoutClosed(listener: (id: number) => void): () => void {
    return (
      this.bridge?.on(WindowChannel.PopoutClosed, (...args: unknown[]): void => {
        if (typeof args[0] === 'number') {
          listener(args[0]);
        }
      }) ?? ((): void => undefined)
    );
  }
}
