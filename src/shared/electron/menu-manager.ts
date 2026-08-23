import { BrowserWindow, ipcMain, IpcMainEvent, Menu, MenuItemConstructorOptions } from 'electron';
import { MenuChannel } from '@shared/api/menu-channels';
import { AppMenuItem, AppMenuSection } from '@shared/api/menu-types';
import { logger } from '@shared/electron/logger';

/**
 * Renders the application menu the renderer composes.
 *
 * The menu is contextual — it follows the active tab, exactly as the ribbon does — so it is built in the
 * renderer, where the active tab, its commands and their enablement are known, and published here as
 * data. This process owns only the rendering and the click round-trip: an item carries a command id, and
 * choosing it sends that id back for the renderer to dispatch.
 *
 * On macOS the menu bar lives outside the window, so the native menu is the right surface and this class
 * is the whole story. On Windows and Linux the application's custom chrome makes a native in-window menu
 * bar look wrong, and a software-rendered bar is the intended answer (#362); until that exists the same
 * native menu is installed there, which is no worse than the default menu it replaces.
 */
export class MenuManager {
  /**
   * Holds the window commands are dispatched to.
   */
  private readonly windowGetter: () => BrowserWindow | null;

  /**
   * Initializes a new instance of the {@link MenuManager} class.
   * @param windowGetter Resolves the window menu commands are dispatched to.
   */
  public constructor(windowGetter: () => BrowserWindow | null) {
    this.windowGetter = windowGetter;
  }

  /**
   * Registers the menu IPC handlers.
   */
  public register(): void {
    logger.info('MenuManager', 'Registering menu IPC handlers');
    ipcMain.on(MenuChannel.SetMenu, (_event: IpcMainEvent, sections: unknown): void => {
      if (!Array.isArray(sections)) {
        return;
      }
      this.install(sections as readonly AppMenuSection[]);
    });
  }

  /**
   * Builds and installs the native menu from the published model.
   * @param sections The menu bar's sections, in bar order.
   */
  private install(sections: readonly AppMenuSection[]): void {
    logger.trace('MenuManager.install', `Installing ${sections.length} menu section(s)`);
    const template: MenuItemConstructorOptions[] = sections.map(
      (section: AppMenuSection): MenuItemConstructorOptions => ({
        label: section.label,
        submenu: section.items.map(
          (item: AppMenuItem): MenuItemConstructorOptions => this.buildItem(item),
        ),
      }),
    );
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  }

  /**
   * Converts one published entry into its native counterpart.
   * @param item The published entry.
   * @returns Returns the native menu item options.
   */
  private buildItem(item: AppMenuItem): MenuItemConstructorOptions {
    if (item.kind === 'separator') {
      return { type: 'separator' };
    }
    // A role is the platform's own behaviour (about, services, quit, minimise); handled natively rather
    // than reimplemented, so it keeps the conventions users expect of it.
    if (item.role !== undefined) {
      return {
        role: item.role as MenuItemConstructorOptions['role'],
        ...(item.label === undefined ? {} : { label: item.label }),
      };
    }
    if (item.items !== undefined) {
      return {
        label: item.label ?? '',
        submenu: item.items.map(
          (child: AppMenuItem): MenuItemConstructorOptions => this.buildItem(child),
        ),
      };
    }
    const commandId: string | undefined = item.id;
    return {
      label: item.label ?? '',
      enabled: item.enabled !== false,
      ...(item.kind === 'checkbox' ? { type: 'checkbox', checked: item.checked === true } : {}),
      ...(item.accelerator === undefined ? {} : { accelerator: item.accelerator }),
      ...(commandId === undefined
        ? {}
        : {
            click: (): void => {
              logger.debug('MenuManager', `Menu command chosen: ${commandId}`);
              this.windowGetter()?.webContents.send(MenuChannel.Command, commandId);
            },
          }),
    };
  }
}
