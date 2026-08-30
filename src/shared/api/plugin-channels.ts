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
   * Reports the revision of the curated catalogue in force this launch (invoke).
   */
  CatalogueRevision = 'plugins:catalogue-revision',

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
 * Describes where a plugin's payload actually comes from, for the consent step.
 *
 * Derived from the pinned URLs rather than declared, because a manifest's author could write anything
 * in a `publisher` field and this is exactly the claim a user is being asked to weigh. What can be
 * shown honestly is what will be fetched, and from where.
 */
export interface PluginOrigin {
  /**
   * Gets the distinct hosts the payload is fetched from, in first-seen order.
   */
  readonly hosts: readonly string[];

  /**
   * Gets how many separate packages arrive: one for an archive, and the whole tree for an npm
   * provision — which is the number worth seeing, since a dependency tree is written by many more
   * people than the one named on the entry.
   */
  readonly packageCount: number;
}

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

  /**
   * Gets the version actually on disk, or null when the plugin is not installed.
   *
   * Not the same as {@link version}, which is the version the catalogue currently offers. They differ
   * exactly when an update is waiting: the user consented to what is installed, and a newer entry does
   * not get to arrive without being asked for.
   */
  readonly installedVersion: string | null;

  /**
   * Gets where the payload comes from, or null when Studio cannot say — a plugin built from source or
   * provisioned by first-party code that fetches nothing pinned. Null is shown as "Studio cannot
   * describe what this installs", never as an absence of risk.
   */
  readonly origin: PluginOrigin | null;
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
