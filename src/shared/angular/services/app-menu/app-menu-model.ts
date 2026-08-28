import { AppMenuItemKind } from '@shared/api/menu-types';

/**
 * A menu entry as the renderer authors it: the wire model plus the handler to run, which never leaves
 * the renderer. {@link AppMenu} strips the handlers when it publishes the menu and routes a chosen
 * command back to the one registered under its id.
 */
export interface MenuEntry {
  /**
   * Gets the command identifier. Required for anything runnable, so a chosen command can be routed back;
   * absent for separators and for a submenu that only groups other entries.
   */
  readonly id?: string;

  /**
   * Gets the entry's label. Absent for separators.
   */
  readonly label?: string;

  /**
   * Gets how the entry behaves. Defaults to a plain command.
   */
  readonly kind?: AppMenuItemKind;

  /**
   * Gets the accelerator shown against the entry, in Electron's notation.
   */
  readonly accelerator?: string;

  /**
   * Gets whether the entry can be chosen. Defaults to enabled. A command that does not apply right now
   * is disabled rather than hidden, so the menu stays a stable map of what the app can do rather than a
   * shifting list of what it can do this second.
   */
  readonly enabled?: boolean;

  /**
   * Gets whether a checkbox entry is ticked.
   */
  readonly checked?: boolean;

  /**
   * Gets a native role to defer to instead of running a handler.
   */
  readonly role?: string;

  /**
   * Gets the native editing role to perform in place of {@link run} while a text box has focus.
   *
   * This is how a tab keeps an editing chord of its own without taking it from whatever the user is
   * actually typing into. A menu accelerator fires before the renderer sees the key at all, so an
   * explorer binding ⌘V to "paste the copied files" would otherwise swallow ⌘V for a composer or a
   * settings field docked beside it. Declaring the role the chord stands for lets the command run
   * only when focus is somewhere the platform's own behaviour would be wrong.
   *
   * An entry carrying one must not also be disabled through {@link enabled}: a disabled entry's
   * accelerator is dead, which would take the chord from every text box on the tab.
   */
  readonly editingRole?: string;

  /**
   * Gets a submenu's entries.
   */
  readonly items?: readonly MenuEntry[];

  /**
   * Runs the command. Kept in the renderer; never published.
   */
  readonly run?: () => void;
}

/**
 * A top-level menu contributed to the bar.
 */
export interface MenuContribution {
  /**
   * Gets the section's stable identifier. A contribution whose id matches a core section is folded into
   * it, so a feature adds *to* File rather than creating a second File beside it.
   */
  readonly id: string;

  /**
   * Gets the section's label on the bar. Ignored when folding into an existing section.
   */
  readonly label: string;

  /**
   * Gets the section's entries.
   */
  readonly items: readonly MenuEntry[];
}

/**
 * A separator entry, for readability at the call sites that build menus.
 */
export const MENU_SEPARATOR: MenuEntry = { kind: 'separator' };
