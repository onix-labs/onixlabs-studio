import { Service } from '@angular/core';
import { StudioApi } from '@shared/studio-api';

/**
 * Represents the renderer-side wrapper around the Electron Studio bridge exposed on window.studio.
 *
 * When the application runs outside Electron (served as a plain web app or under unit tests) the
 * bridge is absent and the window operations become no-ops.
 */
@Service()
export class Studio {
  /**
   * Holds the Studio bridge, or undefined when running outside Electron.
   */
  private readonly api: StudioApi | undefined = window.studio;

  /**
   * Gets the operating system platform, or 'browser' when running outside Electron.
   */
  public readonly platform: string = this.api?.platform ?? 'browser';

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
    this.api?.windowControls.minimize();
  }

  /**
   * Toggles the application window between its maximized and restored states.
   */
  public toggleMaximizeWindow(): void {
    this.api?.windowControls.toggleMaximize();
  }

  /**
   * Closes the application window.
   */
  public closeWindow(): void {
    this.api?.windowControls.close();
  }

  /**
   * Sets whether the application window may be moved by dragging its draggable regions.
   * @param movable True to allow the window to be moved; false to lock it in place.
   */
  public setWindowMovable(movable: boolean): void {
    this.api?.windowControls.setMovable(movable);
  }

  /**
   * Opens a file-system path in the operating system's default handler.
   * @param path The absolute path to open.
   * @returns Returns a promise that resolves when the request has been dispatched.
   */
  public openPath(path: string): Promise<void> {
    return this.api?.shell.openPath(path) ?? Promise.resolve();
  }
}
