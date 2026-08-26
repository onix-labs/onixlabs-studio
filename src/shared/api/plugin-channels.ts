import { LanguageSlotEntry } from './language-slot';

// Shared plugin contract used between the Electron main process and the renderer. Keep this module
// platform-neutral (no Node or DOM dependencies) so both compilation targets can import it.
//
// A plugin is a unit the user installs. What it *contributes* is one or more implementations into a
// slot the application defines (a language server for Python, a debug adapter for C#). This is the
// three-layer model: the catalogue says what is AVAILABLE, the install state says what is INSTALLED
// on this machine, and — only among what is installed — the user CHOOSES which one fills each slot.

/**
 * Names the plugin IPC channels.
 */
export enum PluginChannel {
  /**
   * Lists every known plugin with its current install state (invoke).
   */
  List = 'plugins:list',

  /**
   * Installs a plugin, provisioning whatever it contributes (invoke).
   */
  Install = 'plugins:install',

  /**
   * Uninstalls a plugin, removing what its installation put on disk (invoke).
   */
  Uninstall = 'plugins:uninstall',

  /**
   * Notifies the renderer that a plugin's install state changed (main→renderer, send).
   */
  Changed = 'plugins:changed',
}

/**
 * Names a slot a plugin can contribute an implementation into. The application defines the slots; a
 * plugin fills them. Kept a closed union deliberately — a new slot is a change to the application's
 * own surface, not something a plugin may invent.
 */
export type PluginSlot = 'language-server' | 'debug-adapter';

/**
 * Describes one implementation a plugin contributes into a slot. The identifier is what the slot's
 * registry knows the implementation by, so a plugin's contribution and the registry entry it produces
 * are the same thing named once.
 */
export interface PluginContribution extends LanguageSlotEntry {
  /**
   * Gets the slot this implementation fills.
   */
  readonly slot: PluginSlot;
}

/**
 * Describes a plugin's current state on this machine.
 */
export type PluginState =
  /**
   * Present and usable; its contributions are registered.
   */
  | 'installed'
  /**
   * Known and installable from here.
   */
  | 'available'
  /**
   * An install or uninstall is in flight.
   */
  | 'busy'
  /**
   * Known, but not installable on this machine — the plugin publishes no build for this platform.
   */
  | 'unavailable';

/**
 * Describes one plugin as the renderer sees it: what it is, what it contributes, and where it stands
 * on this machine.
 */
export interface PluginSummary {
  /**
   * Gets the stable plugin identifier.
   */
  readonly id: string;

  /**
   * Gets the display name.
   */
  readonly name: string;

  /**
   * Gets a one-line description of what the plugin is for.
   */
  readonly description: string;

  /**
   * Gets the plugin's state on this machine.
   */
  readonly state: PluginState;

  /**
   * Gets the implementations this plugin contributes.
   */
  readonly contributions: readonly PluginContribution[];

  /**
   * Gets the pinned version Studio installs.
   */
  readonly version: string;

  /**
   * Gets a human-readable note explaining the state — how to install an external tool, or why a plugin
   * is unavailable — or null when the state speaks for itself.
   */
  readonly detail: string | null;
}

/**
 * Reports the outcome of an install or uninstall.
 */
export interface PluginActionResult {
  /**
   * Gets a value indicating whether the action succeeded.
   */
  readonly success: boolean;

  /**
   * Gets the plugin's state after the action.
   */
  readonly state: PluginState;

  /**
   * Gets the failure reason, when the action did not succeed.
   */
  readonly error: string | null;
}

/**
 * Gets the implementations that installed plugins contribute into a slot. This is the join between the
 * two halves of the model: the slot registries are populated from *installed* plugins only, so a
 * plugin the user has not installed can never be offered as a choice.
 * @param plugins The known plugins.
 * @param slot The slot to collect contributions for.
 * @returns Returns the contributions of installed plugins, in catalogue order.
 */
export function installedContributions(
  plugins: readonly PluginSummary[],
  slot: PluginSlot,
): readonly PluginContribution[] {
  return plugins
    .filter((plugin: PluginSummary): boolean => plugin.state === 'installed')
    .flatMap((plugin: PluginSummary): readonly PluginContribution[] => plugin.contributions)
    .filter((contribution: PluginContribution): boolean => contribution.slot === slot);
}
