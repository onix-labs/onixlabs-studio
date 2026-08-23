import { AppMenuSection } from './menu-types';

/**
 * Identifies the IPC channels carrying the application menu between the renderer, which composes it,
 * and the main process, which renders it natively.
 */
export enum MenuChannel {
  /**
   * Publishes the composed menu for the main process to render (renderer→main, send).
   */
  SetMenu = 'menu:set',

  /**
   * Reports that a menu command was chosen, by its identifier (main→renderer, on).
   */
  Command = 'menu:command',

  /**
   * Asks the main process to perform a native window role the renderer cannot (renderer→main, send).
   */
  RunRole = 'menu:run-role',
}

/**
 * The application-menu surface exposed to the renderer.
 */
export interface MenuClient {
  /**
   * Publishes the composed menu for the main process to render.
   * @param sections The menu bar's sections, in bar order.
   */
  setMenu(sections: readonly AppMenuSection[]): void;

  /**
   * Subscribes to menu commands chosen by the user.
   * @param listener Receives the chosen command's identifier.
   * @returns Returns a function that unsubscribes.
   */
  onCommand(listener: (commandId: string) => void): () => void;

  /**
   * Asks the main process to perform a native window role — full screen, developer tools, minimise —
   * which the software-rendered menu cannot do for itself. The native menu performs its own roles, so
   * this is only used by the in-window menu.
   * @param role The role to perform.
   */
  runRole(role: string): void;
}
