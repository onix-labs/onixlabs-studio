import { FormatSlotEntry } from './format-slot';
import { LanguageSlotEntry } from './language-slot';
import { SlotEntry } from './slot';

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
export type PluginSlot =
  'language-server' | 'debug-adapter' | 'decoder' | 'container-engine' | 'agent-harness';

/**
 * Names the slots keyed by language, as opposed to by format.
 */
export type LanguagePluginSlot = 'language-server' | 'debug-adapter';

/**
 * Describes one implementation a plugin contributes into a language-keyed slot. The identifier is what
 * the slot's registry knows the implementation by, so a plugin's contribution and the registry entry it
 * produces are the same thing named once.
 */
export interface LanguagePluginContribution extends LanguageSlotEntry {
  /**
   * Gets the language-keyed slot this implementation fills.
   */
  readonly slot: LanguagePluginSlot;
}

/**
 * Describes one implementation a plugin contributes into a format-keyed slot. A decoder is chosen per
 * binary format rather than per language, which is why it is keyed differently rather than being made
 * to carry a `languages` array it would have nothing to put in.
 */
export interface FormatPluginContribution extends FormatSlotEntry {
  /**
   * Gets the format-keyed slot this implementation fills.
   */
  readonly slot: 'decoder';
}

/**
 * Describes one implementation a plugin contributes into a slot that is keyed by nothing at all.
 *
 * A container engine is chosen once for the application, so it carries neither `languages` nor
 * `formats` — the distinction the slot contract draws between a keyed slot and a plain one, surfaced
 * here rather than papered over with an array that would have nothing to put in it.
 *
 * An agent harness is here for a different reason: it *is* keyed, but by the AI connection it serves,
 * and a connection is user-created data rather than a vocabulary the application owns. There is no
 * fixed key set to declare, so it carries none — which the manifest states instead, as the auth kinds
 * the harness claims.
 */
export interface UnkeyedPluginContribution extends SlotEntry {
  /**
   * Gets the unkeyed slot this implementation fills.
   */
  readonly slot: 'container-engine' | 'agent-harness';
}

/**
 * Describes one implementation a plugin contributes into a slot, whichever way that slot is keyed.
 */
export type PluginContribution =
  LanguagePluginContribution | FormatPluginContribution | UnkeyedPluginContribution;

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
  slot: LanguagePluginSlot,
): readonly LanguagePluginContribution[];
export function installedContributions(
  plugins: readonly PluginSummary[],
  slot: 'decoder',
): readonly FormatPluginContribution[];
export function installedContributions(
  plugins: readonly PluginSummary[],
  slot: 'container-engine' | 'agent-harness',
): readonly UnkeyedPluginContribution[];
export function installedContributions(
  plugins: readonly PluginSummary[],
  slot: PluginSlot,
): readonly PluginContribution[] {
  return plugins
    .filter((plugin: PluginSummary): boolean => plugin.state === 'installed')
    .flatMap((plugin: PluginSummary): readonly PluginContribution[] => plugin.contributions)
    .filter((contribution: PluginContribution): boolean => contribution.slot === slot);
}

/**
 * Describes which contributions fill the slot being asked about.
 *
 * A predicate rather than a slot and a key, because the three slots are not keyed the same way and
 * {@link installedContributions}' overloads exist precisely to say so: a language server is keyed by
 * language, a decoder by binary format, and a container engine by nothing at all. Flattening that into
 * one signature would mean inventing a key for the slot that has none.
 */
export type ContributionMatch = (contribution: PluginContribution) => boolean;

/**
 * Gets the plugins that could fill a slot but are not installed — what to offer a user who has just
 * run into the gap.
 *
 * The counterpart of {@link installedContributions}, and the answer to the same question from the
 * other side. Three prompts each computed this for their own slot before #657, with three
 * implementations that agreed by coincidence rather than by construction.
 *
 * **Nothing is offered once something already fills the slot.** Support that exists is never advertised
 * again, whether the user installed it a moment ago or a year ago.
 *
 * ⚠️ Only `available` plugins are candidates, deliberately narrower than "not installed". A plugin can
 * also be `unavailable` — its publisher ships no build for this platform — and offering one is offering
 * an install the Plugin Manager will refuse. `podman-engine` on an Intel Mac is the live example.
 * @param plugins The known plugins.
 * @param matches Tests whether a contribution fills the slot in question.
 * @returns Returns the installable candidates in catalogue order, or nothing when the slot is filled.
 */
export function slotCandidates(
  plugins: readonly PluginSummary[],
  matches: ContributionMatch,
): readonly PluginSummary[] {
  const fills: (plugin: PluginSummary) => boolean = (plugin: PluginSummary): boolean =>
    plugin.contributions.some(matches);
  if (
    plugins.some((plugin: PluginSummary): boolean => plugin.state === 'installed' && fills(plugin))
  ) {
    return [];
  }
  return plugins.filter(
    (plugin: PluginSummary): boolean => plugin.state === 'available' && fills(plugin),
  );
}

/**
 * Narrows a contribution to the language-keyed form when it fills a language-keyed slot.
 *
 * Exists because `slot` discriminates the union, and narrowing on a comparison against a slot *variable*
 * does not narrow — only a comparison against a literal does. Callers that filter by a slot they were
 * handed need this rather than a cast.
 * @param contribution The contribution to test.
 * @returns Returns true when the contribution is language-keyed.
 */
export function isLanguageContribution(
  contribution: PluginContribution,
): contribution is LanguagePluginContribution {
  return contribution.slot === 'language-server' || contribution.slot === 'debug-adapter';
}
