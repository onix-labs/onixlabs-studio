import { inject, Service } from '@angular/core';
import { Bridge } from '@shared/api/bridge';
import { CHILD_WINDOW_NAME_PATTERN, WindowChannel } from '@shared/api/window-channels';
import { Log } from '@shared/angular/services/log/log';

/**
 * Represents the renderer-side wrapper around the app-shell chrome: window operations and the host
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
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Gets the operating system platform, or 'browser' when running outside Electron.
   */
  public readonly platform: string = window.host?.platform ?? 'browser';

  /**
   * Gets a value indicating whether Studio draws each window's controls itself. Only Linux: macOS
   * insets its traffic lights over the content and Windows draws its caption buttons over it, but a
   * Linux window has no frame at all (see `WindowManager.chrome`).
   */
  public readonly drawsWindowControls: boolean = this.platform === 'linux';

  /**
   * Closes a window.
   * @param view The window to close: this application window by default, or a pop-out or modal
   * window it opened.
   */
  public closeWindow(view: Window = window): void {
    this.log.info('Studio', 'Close window requested');
    this.sendTo(WindowChannel.Close, view);
  }

  /**
   * Minimizes a window.
   * @param view The window to minimize: this application window by default, or a pop-out it opened.
   */
  public minimizeWindow(view: Window = window): void {
    this.sendTo(WindowChannel.Minimize, view);
  }

  /**
   * Toggles a window between its maximized and restored states.
   * @param view The window to toggle: this application window by default, or a pop-out or modal
   * window it opened.
   */
  public toggleMaximizeWindow(view: Window = window): void {
    this.sendTo(WindowChannel.ToggleMaximize, view);
  }

  /**
   * Determines whether a window is maximized.
   * @param view The window to ask about: this application window by default, or a pop-out or modal
   * window it opened.
   * @returns Returns a promise resolving true when the window is maximized; false when it is not, or
   * when it cannot be asked (outside Electron, or a window that cannot be addressed).
   */
  public async isWindowMaximized(view: Window = window): Promise<boolean> {
    const target: [] | [string] | null = this.target(view);
    if (target === null || this.bridge === undefined) {
      return false;
    }
    return (await this.bridge.invoke<boolean>(WindowChannel.IsMaximized, ...target)) === true;
  }

  /**
   * Shows the application window. The main window starts hidden and is only shown once the shell
   * has something to show, so a cold start goes straight to the welcome window with no empty IDE
   * window behind it.
   */
  public showWindow(): void {
    this.log.trace('Studio', 'Showing main window');
    this.bridge?.send(WindowChannel.Show);
  }

  /**
   * Hides the application window without closing it, leaving the application running behind whatever
   * window stands in for it.
   */
  public hideWindow(): void {
    this.log.trace('Studio', 'Hiding main window');
    this.bridge?.send(WindowChannel.Hide);
  }

  /**
   * Sets whether the application window may be moved by dragging its draggable regions.
   * @param movable True to allow the window to be moved; false to lock it in place.
   */
  public setWindowMovable(movable: boolean): void {
    this.bridge?.send(WindowChannel.SetMovable, movable);
  }

  /**
   * Sets the colour of the caption-button glyphs Windows draws over every window. A no-op elsewhere,
   * where the platform draws no such buttons over the content.
   * @param color The glyph colour, as a `#rrggbb` hex string.
   */
  public setCaptionSymbolColor(color: string): void {
    if (this.platform === 'win32') {
      this.bridge?.send(WindowChannel.SetCaptionSymbolColor, color);
    }
  }

  /**
   * Sends a window-control request for a window, or nothing when the window cannot be addressed.
   * @param channel The window-control channel.
   * @param view The window the request is for.
   */
  private sendTo(channel: WindowChannel, view: Window): void {
    const target: [] | [string] | null = this.target(view);
    if (target !== null) {
      this.bridge?.send(channel, ...target);
    }
  }

  /**
   * Builds the arguments that name a window-control request's target. A pop-out or modal window is
   * a child this window scripts directly, so its requests travel over this window's bridge and name
   * the child by the name it was opened with; this window's own requests name nothing.
   *
   * 🔥 A child without a child-window name yields null, never the empty list: a request naming nothing
   * acts on THIS window, so a close meant for a dialog would close the application window instead.
   * @param view The window the request is for.
   * @returns Returns the request's arguments, or null when the window cannot be addressed.
   */
  private target(view: Window): [] | [string] | null {
    if (view === window) {
      return [];
    }
    return CHILD_WINDOW_NAME_PATTERN.test(view.name) ? [view.name] : null;
  }
}
