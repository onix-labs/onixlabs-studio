import { ipcMain } from 'electron';
import { IconTheme, IconThemeChannel } from '@shared/api/icon-theme';
import { loadIconTheme } from './load-icon-theme';

/**
 * Serves the active icon theme to the renderer.
 *
 * SPIKE (#1551): the theme is an unpacked VS Code extension named by `STUDIO_ICON_THEME`, so the
 * renderer never names a path. A plugin contribution and a setting take its place (#1554).
 */
export class IconThemeManager {
  /**
   * Holds the theme, loaded once when first asked for.
   */
  private theme: Promise<IconTheme | null> | undefined;

  /**
   * Registers the icon theme IPC handler.
   */
  public register(): void {
    ipcMain.handle(IconThemeChannel.GetActive, (): Promise<IconTheme | null> => {
      const folder: string | undefined = process.env['STUDIO_ICON_THEME'];
      this.theme ??= folder ? loadIconTheme(folder) : Promise.resolve(null);
      return this.theme;
    });
  }
}
