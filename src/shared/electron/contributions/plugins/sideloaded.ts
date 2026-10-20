import { app } from 'electron';
import { Dirent, existsSync, readdirSync } from 'node:fs';
import * as path from 'node:path';
import { SideloadingState } from '@shared/api/plugin-channels';
import { PluginManifest } from '@shared/api/plugin-manifest';
import { logger } from '../../logger';
import { StartupPreferencesStore } from '../../startup-preferences';
import { LoadedPlugin, MANIFEST_FILE, discoverPlugins, validManifests } from './plugin-loader';

/**
 * Caches the manifests found on disk, so the directory is scanned once per launch. A plugin appearing
 * or leaving mid-session is deliberately not watched: what is registered would have to be unregistered
 * from live sessions, and that is the loader's next problem rather than this one.
 */
let cached: readonly LoadedPlugin[] | null = null;

/**
 * Holds whether sideloaded plugins are loaded this launch, resolved once on first use and never again:
 * a plugin the registries have already resolved cannot be taken back mid-session, so a change to the
 * switch waits for the next launch rather than half-applying.
 */
let inForce: boolean | null = null;

/**
 * Holds how many sideloaded plugins were found on disk and not loaded this launch.
 */
let skipped: number = 0;

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
  return validManifests(scan());
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
  const directories: Map<string, string> = new Map<string, string>();
  for (const plugin of scan()) {
    if (plugin.manifest !== null) {
      directories.set(plugin.manifest.id, plugin.directory);
    }
  }
  return directories;
}

/**
 * Decides whether sideloaded plugins are loaded (#979).
 *
 * A sideloaded plugin skips the integrity check every catalogue plugin goes through and replaces a
 * catalogue entry of the same id, so anything able to write to the user-data directory could plant one.
 * A packaged build therefore loads none until the user says otherwise. The development app always loads
 * them: running a plugin built locally is what it is for, and it has its own user-data directory.
 * @param isPackaged Whether this is a packaged build.
 * @param preference The user's persisted choice, or null when they have not made one.
 * @returns Returns true when sideloaded plugins are loaded.
 */
export function resolveSideloading(isPackaged: boolean, preference: boolean | null): boolean {
  return !isPackaged || preference === true;
}

/**
 * Gets whether sideloaded plugins are loaded this launch, reading the choice synchronously from the
 * startup preferences on first use. First use is the first plugin lookup, so the choice is always known
 * before anything is resolved from the sideload directory.
 * @returns Returns true when sideloaded plugins are loaded.
 */
export function sideloadingInForce(): boolean {
  inForce ??= resolveSideloading(
    app.isPackaged,
    StartupPreferencesStore.read().loadSideloadedPlugins,
  );
  return inForce;
}

/**
 * Gets the sideloading switch's state: the choice that applies from the next launch, what is in force
 * this launch, and how many plugins that left out.
 * @returns Returns the state.
 */
export function sideloadingState(): SideloadingState {
  scan();
  const locked: boolean = !app.isPackaged;
  return {
    enabled: resolveSideloading(
      app.isPackaged,
      StartupPreferencesStore.read().loadSideloadedPlugins,
    ),
    inForce: sideloadingInForce(),
    locked,
    skipped,
  };
}

/**
 * Validates and persists the user's sideloading choice, to take effect on the next launch.
 *
 * Refused in the development app, where sideloaded plugins always load and the switch is shown locked.
 * @param value The candidate choice from the renderer.
 * @returns Returns the state after the change (unchanged when the candidate is refused).
 */
export function setSideloading(value: unknown): SideloadingState {
  if (typeof value !== 'boolean') {
    logger.warn('SideloadedPlugins', 'Ignored a sideloading choice that is not a boolean');
  } else if (!app.isPackaged) {
    logger.debug(
      'SideloadedPlugins',
      'Ignored a sideloading choice: the development app always loads them',
    );
  } else {
    StartupPreferencesStore.write({ loadSideloadedPlugins: value });
    logger.info(
      'SideloadedPlugins',
      `Sideloaded plugins will be ${value ? 'loaded' : 'skipped'} from the next launch`,
    );
  }
  return sideloadingState();
}

/**
 * Scans the sideload directory once per launch, or — when sideloading is off — counts what it would
 * have found without reading a single manifest, so the log can say what was left out.
 * @returns Returns the discovered plugins, empty when sideloading is off.
 */
function scan(): readonly LoadedPlugin[] {
  if (cached !== null) {
    return cached;
  }
  const directory: string = sideloadDirectory();
  if (sideloadingInForce()) {
    cached = discoverPlugins(directory);
    return cached;
  }
  skipped = countPluginDirectories(directory);
  logger.info(
    'SideloadedPlugins',
    `Skipped ${skipped} sideloaded ${skipped === 1 ? 'plugin' : 'plugins'} in ${directory}: ` +
      "'Load sideloaded plugins' is off in the Plugin Manager settings",
  );
  cached = [];
  return cached;
}

/**
 * Counts the plugin directories in the sideload directory — the subdirectories holding a manifest —
 * without reading any of them.
 * @param directory The sideload directory.
 * @returns Returns the count, zero when the directory is absent or unreadable.
 */
export function countPluginDirectories(directory: string): number {
  try {
    if (!existsSync(directory)) {
      return 0;
    }
    return readdirSync(directory, { withFileTypes: true }).filter(
      (entry: Dirent): boolean =>
        entry.isDirectory() && existsSync(path.join(directory, entry.name, MANIFEST_FILE)),
    ).length;
  } catch (error: unknown) {
    logger.debug('SideloadedPlugins', `Could not count the plugins in ${directory}`, error);
    return 0;
  }
}
