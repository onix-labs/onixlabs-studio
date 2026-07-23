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
   * Sets whether this window floats above every other window — the pop-out title-bar's pin.
   * @param pinned True to keep the window on top; false to restore normal stacking.
   */
  public setWindowAlwaysOnTop(pinned: boolean): void {
    this.bridge?.send(WindowChannel.SetAlwaysOnTop, pinned);
  }
}
