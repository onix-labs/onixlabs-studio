/**
 * The application menu's wire model, shared by the renderer that composes the menu and the main process
 * that renders it natively. Deliberately data — not components and not callbacks — because it has to
 * cross the IPC boundary; the renderer keeps the handlers and the wire model carries only command ids.
 */

/**
 * Identifies how a menu item behaves.
 */
export type AppMenuItemKind = 'command' | 'separator' | 'checkbox' | 'submenu';

/**
 * A single entry in a menu: a command, a separator, a checkbox, or a submenu of further entries.
 */
export interface AppMenuItem {
  /**
   * Gets the command identifier raised when the item is chosen, and the key the renderer routes it back
   * to a handler by. Absent for separators and for a submenu that only groups other items.
   */
  readonly id?: string;

  /**
   * Gets the item's label. Absent for separators.
   */
  readonly label?: string;

  /**
   * Gets how the item behaves. Defaults to a plain command.
   */
  readonly kind?: AppMenuItemKind;

  /**
   * Gets the accelerator shown against the item, in Electron's notation (`CmdOrCtrl+S`). The menu
   * displays it and the platform dispatches it, so an item's accelerator must agree with the
   * application's effective keybinding for the same command or the two would compete.
   */
  readonly accelerator?: string;

  /**
   * Gets whether the item can be chosen. Defaults to enabled. A command that does not apply right now
   * is shown disabled rather than hidden, so the menu stays a stable map of what the app can do.
   */
  readonly enabled?: boolean;

  /**
   * Gets whether a checkbox item is ticked.
   */
  readonly checked?: boolean;

  /**
   * Gets a native menu role to defer to instead of a command — used for the entries the platform owns
   * (about, services, hide, quit, minimise, zoom), which behave better handled natively than
   * reimplemented.
   */
  readonly role?: string;

  /**
   * Gets a submenu's entries.
   */
  readonly items?: readonly AppMenuItem[];
}

/**
 * A top-level menu on the bar — File, Edit, View and so on.
 */
export interface AppMenuSection {
  /**
   * Gets the section's stable identifier, which also determines where a contribution merges: a
   * contributed section whose id matches a core section is folded into it rather than added beside it,
   * so a feature adds *to* File rather than creating a second File.
   */
  readonly id: string;

  /**
   * Gets the section's label on the menu bar.
   */
  readonly label: string;

  /**
   * Gets the section's entries.
   */
  readonly items: readonly AppMenuItem[];
}
