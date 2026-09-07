import { app } from 'electron';
import * as path from 'node:path';
import { PluginManifest } from '@shared/api/plugin-manifest';
import { LoadedPlugin, discoverPlugins, validManifests } from './plugin-loader';

/**
 * Caches the manifests found on disk, so the directory is scanned once per launch. A plugin appearing
 * or leaving mid-session is deliberately not watched: what is registered would have to be unregistered
 * from live sessions, and that is the loader's next problem rather than this one.
 */
let cached: readonly LoadedPlugin[] | null = null;

/**
 * Gets the directory sideloaded plugins are dropped into: one subdirectory per plugin, each holding a
 * `plugin.json`. Under the user-data directory rather than a workspace, because a language server is
 * something the user has, not something a project has.
 * @returns Returns the directory.
 */
export function sideloadDirectory(): string {
  return path.join(app.getPath('userData'), 'plugins');
}

/**
 * Gets the manifests of the sideloaded plugins that validated.
 *
 * This is one of the two routes a contributed plugin arrives by; what becomes of them — descriptors,
 * registry entries, Plugin Manager rows — is decided once the routes have been merged, in
 * `contributed.ts`.
 * @returns Returns the manifests.
 */
export function sideloadedManifests(): readonly PluginManifest[] {
  cached ??= discoverPlugins(sideloadDirectory());
  return validManifests(cached);
}

/**
 * Gets the directory each sideloaded plugin was found in, keyed by plugin identifier.
 *
 * A sideloaded plugin may carry its own payload beside its manifest, which is the only way a plugin
 * built locally can be run at all: everything else resolves its payload through the provisioner, and a
 * plugin that has not been published has nothing to download. Knowing where a manifest came from is
 * what makes that possible.
 *
 * Deliberately only for sideloaded plugins. A catalogue plugin's payload is always fetched and hashed;
 * this route exists because the user put the plugin in their own user-data directory by hand, which is
 * already the larger trust decision.
 * @returns Returns the directory per plugin identifier.
 */
export function sideloadedDirectories(): ReadonlyMap<string, string> {
  cached ??= discoverPlugins(sideloadDirectory());
  const directories: Map<string, string> = new Map<string, string>();
  for (const plugin of cached) {
    if (plugin.manifest !== null) {
      directories.set(plugin.manifest.id, plugin.directory);
    }
  }
  return directories;
}
