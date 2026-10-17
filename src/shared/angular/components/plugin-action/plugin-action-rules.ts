import type { PluginSummary } from '@shared/api/plugin-channels';

/**
 * Gets whether a plugin can be installed from here.
 * @param plugin The plugin.
 * @returns Returns true when an Install action applies.
 */
export function canInstall(plugin: PluginSummary): boolean {
  return plugin.state === 'available';
}

/**
 * Gets whether a plugin can be removed from here. Every installed plugin can — that is what makes it a
 * plugin rather than part of the application.
 * @param plugin The plugin.
 * @returns Returns true when a Remove action applies.
 */
export function canUninstall(plugin: PluginSummary): boolean {
  return plugin.state === 'installed';
}

/**
 * Gets whether a newer version is waiting.
 *
 * The installed version is what the user accepted; a catalogue that has moved on does not get to arrive
 * without being asked. So this is an offer, not a state the plugin drifts into.
 * @param plugin The plugin.
 * @returns Returns true when what is installed is not what the catalogue now offers.
 */
export function canUpdate(plugin: PluginSummary): boolean {
  return (
    plugin.state === 'installed' &&
    plugin.installedVersion !== null &&
    plugin.installedVersion !== plugin.version
  );
}
