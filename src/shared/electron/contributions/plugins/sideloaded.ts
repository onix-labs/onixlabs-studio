import { app } from 'electron';
import * as path from 'node:path';
import { PluginManifest } from '@shared/api/plugin-manifest';
import { LanguageServerDescriptor } from '../../lsp/language-server-descriptor';
import {
  discoverPlugins,
  toLanguageServerDescriptors,
  toPluginDescriptor,
  validManifests,
} from './plugin-loader';
import { PluginDescriptor } from './plugin-catalogue';

/**
 * Caches the manifests found on disk, so the directory is scanned once per launch. A plugin appearing
 * or leaving mid-session is deliberately not watched: what is registered would have to be unregistered
 * from live sessions, and that is the loader's next problem rather than this one.
 */
let cached: readonly PluginManifest[] | null = null;

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
 * @returns Returns the manifests.
 */
export function sideloadedManifests(): readonly PluginManifest[] {
  cached ??= validManifests(discoverPlugins(sideloadDirectory()));
  return cached;
}

/**
 * Gets the sideloaded plugins as Plugin Manager entries, so they list, install and remove exactly like
 * the first-party ones.
 * @returns Returns the descriptors.
 */
export function sideloadedPlugins(): readonly PluginDescriptor[] {
  return sideloadedManifests().map(toPluginDescriptor);
}

/**
 * Gets the language servers the sideloaded plugins contribute, for the server registry to resolve.
 * @returns Returns the descriptors.
 */
export function sideloadedLanguageServers(): readonly LanguageServerDescriptor[] {
  return sideloadedManifests().flatMap(toLanguageServerDescriptors);
}
