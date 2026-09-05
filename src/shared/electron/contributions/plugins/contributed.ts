import { app } from 'electron';
import { PluginManifest } from '@shared/api/plugin-manifest';
import { logger } from '../../logger';
import { DebugAdapterCatalogueEntry } from '../../debug/debug-adapter-registry';
import { LanguageServerDescriptor } from '../../lsp/language-server-descriptor';
import { LspProvisioner } from '../../lsp/lsp-provisioner';
import { PluginDescriptor } from './plugin-catalogue';
import { PluginIndex } from './plugin-index';
import {
  NodeRuntimeSpec,
  toContainerEngineDescriptors,
  toDebugAdapterEntries,
  toDecoderDescriptors,
  toLanguageServerDescriptors,
  toPluginDescriptor,
} from './plugin-loader';
import { sideloadedDirectories, sideloadedManifests } from './sideloaded';
import { DecoderDescriptor } from '../../decoders/decoder-descriptor';
import { ContainerEngineDescriptor } from '../containers/container-engine';

// Everything Studio did not compile in: the plugins dropped into the sideload directory and the plugins
// the curated index offers. They arrive by different routes and are the same kind of thing once they
// have — a validated manifest — so they are merged into one set here and nowhere else.
//
// Merging in one place is the point. The Plugin Manager, the language-server registry and the debug
// registry all read from this, so a plugin the manager lists is exactly the plugin the registries
// resolve. Deduplicating separately in each of them would let the three disagree about which plugin an
// id means, which is a bug nobody would find until a server spawned from the wrong archive.

/**
 * A place contributed manifests come from, named so a collision between two of them can be reported in
 * terms the user could act on.
 */
export interface ManifestSource {
  /**
   * Gets where these manifests came from, for the log.
   */
  readonly origin: string;

  /**
   * Gets the manifests it offers.
   */
  readonly manifests: readonly PluginManifest[];
}

/**
 * Merges contributed manifests from several sources into one set, keyed by plugin identifier.
 *
 * **The first registration wins, and the collision is logged.** Not namespaced: an id reaches the file
 * system as an install directory and reaches settings as a persisted key, so quietly rewriting one
 * would break the very things it identifies. Not last-wins either — that would let a published index
 * silently displace something the user put on their own machine by hand.
 *
 * Source order is therefore the precedence order, and it runs from most local to least: what the user
 * placed themselves beats what Studio fetched on their behalf.
 * @param sources The sources, in precedence order.
 * @returns Returns the merged manifests, in source and then document order.
 */
export function mergeManifests(sources: readonly ManifestSource[]): readonly PluginManifest[] {
  const merged: Map<string, PluginManifest> = new Map<string, PluginManifest>();
  const origins: Map<string, string> = new Map<string, string>();
  for (const source of sources) {
    for (const manifest of source.manifests) {
      const claimed: string | undefined = origins.get(manifest.id);
      if (claimed !== undefined) {
        logger.warn(
          'ContributedPlugins',
          `Ignoring '${manifest.id}' from ${source.origin}: ${claimed} already contributes that id`,
        );
        continue;
      }
      origins.set(manifest.id, source.origin);
      merged.set(manifest.id, manifest);
    }
  }
  return [...merged.values()];
}

/**
 * Holds the curated index, opened once per launch.
 */
let index: PluginIndex | null = null;

/**
 * Gets the curated index, opening it against the user-data directory on first use.
 * @returns Returns the index.
 */
export function pluginIndex(): PluginIndex {
  index ??= new PluginIndex(app.getPath('userData'));
  return index;
}

/**
 * Caches the merged set, so the sources are read and reconciled once per launch and every reader sees
 * the same answer.
 */
let contributed: readonly PluginManifest[] | null = null;

/**
 * Gets every contributed plugin's manifest: sideloaded first, then indexed.
 * @returns Returns the manifests.
 */
export function contributedManifests(): readonly PluginManifest[] {
  contributed ??= mergeManifests([
    { origin: 'the sideload directory', manifests: sideloadedManifests() },
    { origin: 'the curated index', manifests: pluginIndex().manifests() },
  ]);
  return contributed;
}

/**
 * Gets the contributed plugins as Plugin Manager entries, so they list, install and remove exactly like
 * the first-party ones.
 * @returns Returns the descriptors.
 */
export function contributedPlugins(): readonly PluginDescriptor[] {
  const local: ReadonlyMap<string, string> = sideloadedDirectories();
  return contributedManifests().map((manifest: PluginManifest): PluginDescriptor =>
    toPluginDescriptor(manifest, local.get(manifest.id)),
  );
}

/**
 * Gets the language servers the contributed plugins provide, for the server registry to resolve.
 * @returns Returns the descriptors.
 */
export function contributedLanguageServers(): readonly LanguageServerDescriptor[] {
  return contributedManifests().flatMap(toLanguageServerDescriptors);
}

/**
 * Gets the debug adapters the contributed plugins provide, for the debug registry to resolve.
 * @returns Returns the catalogue entries.
 */
export function contributedDebugAdapters(): readonly DebugAdapterCatalogueEntry[] {
  return contributedManifests().flatMap((manifest): readonly DebugAdapterCatalogueEntry[] =>
    toDebugAdapterEntries(manifest, payloadProvisioner),
  );
}

/**
 * Gets the decoders the contributed plugins provide, for the decoder registry to resolve.
 *
 * Studio contributes none of its own: every decoder the binary editor uses, including for native
 * machine code, arrives through here.
 * @param nodeRuntime Gets how to run a JavaScript entry point under the runtime Studio ships.
 * @returns Returns the descriptors.
 */
export function contributedDecoders(
  nodeRuntime: (entryPoint: string) => NodeRuntimeSpec,
): readonly DecoderDescriptor[] {
  const local: ReadonlyMap<string, string> = sideloadedDirectories();
  return contributedManifests().flatMap((manifest): readonly DecoderDescriptor[] =>
    toDecoderDescriptors(manifest, payloadProvisioner, nodeRuntime, local.get(manifest.id)),
  );
}

/**
 * Gets the container engines the contributed plugins provide, for the engine catalogue to offer.
 *
 * Only engines whose payload is installed appear: an engine that is not installed is not something the
 * user can choose, and offering it would be offering a connection that cannot be made.
 * @returns Returns the descriptors.
 */
export function contributedContainerEngines(): readonly ContainerEngineDescriptor[] {
  const local: ReadonlyMap<string, string> = sideloadedDirectories();
  return contributedManifests().flatMap((manifest): readonly ContainerEngineDescriptor[] =>
    toContainerEngineDescriptors(manifest, payloadProvisioner, local.get(manifest.id)),
  );
}

/**
 * Holds a provisioner used only to answer where a contributed plugin's payload was installed. The same
 * one the plugin's install went through, so the answer cannot disagree with where the payload actually
 * landed.
 */
let payloads: LspProvisioner | null = null;

/**
 * Gets the provisioner contributed plugins were installed through, constructed on first use.
 * @returns Returns the provisioner.
 */
function payloadProvisioner(): LspProvisioner {
  payloads ??= new LspProvisioner();
  return payloads;
}
