import { existsSync, readdirSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import {
  ManifestCommand,
  ManifestDebugAdapter,
  ManifestDownload,
  ManifestError,
  ManifestLanguageServer,
  ManifestResult,
  parsePluginManifest,
  PluginManifest,
} from '@shared/api/plugin-manifest';
import { PluginContribution } from '@shared/api/plugin-channels';
import { logger } from '../../logger';
import {
  LanguageServerContext,
  LanguageServerDescriptor,
  LspResolution,
  resolved,
  unavailable,
} from '../../lsp/language-server-descriptor';
import { ArchiveDownload, ArchiveProvision } from '../../provisioning/archive-provision';
import { PluginContext, PluginDescriptor } from './plugin-catalogue';

/**
 * The file a sideloaded plugin is described by, inside its own directory.
 */
export const MANIFEST_FILE: string = 'plugin.json';

/**
 * A plugin found on disk: its manifest when it validated, otherwise why it did not.
 */
export interface LoadedPlugin {
  /**
   * Gets the directory the plugin was found in.
   */
  readonly directory: string;

  /**
   * Gets the validated manifest, or null when it was refused.
   */
  readonly manifest: PluginManifest | null;

  /**
   * Gets the reasons it was refused, empty when it validated.
   */
  readonly errors: readonly ManifestError[];
}

/**
 * Discovers the plugins sideloaded into a directory: one subdirectory per plugin, each holding a
 * {@link MANIFEST_FILE}.
 *
 * Nothing is executed to find out what a plugin is — the manifest says, and a manifest that does not
 * validate is refused with its reasons rather than partially believed. One bad plugin does not stop the
 * others: it is reported and skipped, because a broken plugin should cost the user that plugin and
 * nothing else.
 * @param directory The directory to scan.
 * @returns Returns what was found, valid and invalid alike, in directory order.
 */
export function discoverPlugins(directory: string): readonly LoadedPlugin[] {
  if (!existsSync(directory)) {
    return [];
  }
  const found: LoadedPlugin[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const pluginDirectory: string = path.join(directory, entry.name);
    const manifestPath: string = path.join(pluginDirectory, MANIFEST_FILE);
    if (!existsSync(manifestPath)) {
      continue;
    }
    found.push(readManifest(pluginDirectory, manifestPath));
  }
  return found;
}

/**
 * Reads and validates one plugin's manifest.
 * @param directory The plugin's directory.
 * @param manifestPath The manifest file.
 * @returns Returns the loaded plugin.
 */
function readManifest(directory: string, manifestPath: string): LoadedPlugin {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (error: unknown) {
    logger.warn('PluginLoader', `Could not read ${manifestPath}`, error);
    return {
      directory,
      manifest: null,
      errors: [{ path: MANIFEST_FILE, message: 'is not readable JSON' }],
    };
  }
  const result: ManifestResult = parsePluginManifest(parsed);
  if (result.manifest === null) {
    for (const error of result.errors) {
      logger.warn('PluginLoader', `Refused ${manifestPath}: ${error.path} ${error.message}`);
    }
  } else {
    logger.info('PluginLoader', `Loaded plugin '${result.manifest.id}' from ${directory}`);
  }
  return { directory, manifest: result.manifest, errors: result.errors };
}

/**
 * Gets the manifests that validated, discarding the ones that did not.
 * @param plugins The discovered plugins.
 * @returns Returns the valid manifests.
 */
export function validManifests(plugins: readonly LoadedPlugin[]): readonly PluginManifest[] {
  return plugins
    .map((plugin: LoadedPlugin): PluginManifest | null => plugin.manifest)
    .filter((manifest: PluginManifest | null): manifest is PluginManifest => manifest !== null);
}

/**
 * Turns a manifest's provisioning into the recipe the archive provisioner installs from. The shapes
 * are deliberately the same: the manifest format was derived from this recipe, so a contributed plugin
 * installs through exactly the same path as a first-party one.
 * @param manifest The validated manifest.
 * @returns Returns the provisioning recipe.
 */
export function toProvision(manifest: PluginManifest): ArchiveProvision {
  const downloads: Record<string, ArchiveDownload> = {};
  for (const [platform, download] of Object.entries(manifest.provision.downloads)) {
    const source: ManifestDownload = download;
    downloads[platform] = {
      url: source.url,
      sha256: source.sha256,
      archive: source.archive,
      executablePath: source.executablePath,
    };
  }
  return { id: manifest.id, version: manifest.version, downloads };
}

/**
 * Turns a manifest's contributions into the plain data the Plugin Manager lists.
 * @param manifest The validated manifest.
 * @returns Returns the contributions.
 */
export function toContributions(manifest: PluginManifest): readonly PluginContribution[] {
  const servers: readonly PluginContribution[] = (manifest.contributes.languageServers ?? []).map(
    (server: ManifestLanguageServer): PluginContribution => ({
      slot: 'language-server',
      id: server.id,
      displayName: server.displayName,
      languages: server.languages,
      priority: server.priority,
    }),
  );
  const adapters: readonly PluginContribution[] = (manifest.contributes.debugAdapters ?? []).map(
    (adapter: ManifestDebugAdapter): PluginContribution => ({
      slot: 'debug-adapter',
      id: adapter.id,
      displayName: adapter.displayName,
      languages: adapter.languages,
      priority: adapter.priority,
    }),
  );
  return [...servers, ...adapters];
}

/**
 * Turns a validated manifest into a plugin the Plugin Manager can install and remove, exactly like a
 * first-party one. A sideloaded plugin is not a special case: it is a catalogue entry that happened to
 * arrive as data rather than as code.
 * @param manifest The validated manifest.
 * @returns Returns the descriptor.
 */
export function toPluginDescriptor(manifest: PluginManifest): PluginDescriptor {
  const provision: ArchiveProvision = toProvision(manifest);
  const requires: string = manifest.requires
    .map((requirement): string =>
      requirement.minimumVersion === undefined
        ? requirement.runtime
        : `${requirement.runtime} ${requirement.minimumVersion}+`,
    )
    .join(', ');
  return {
    id: manifest.id,
    name: manifest.name,
    description: manifest.description,
    version: manifest.version,
    contributions: toContributions(manifest),
    detail: requires.length === 0 ? undefined : `Needs ${requires} to run once installed.`,
    supported: (context: PluginContext): boolean =>
      context.provisioner.archiveTarget(provision) !== null,
    detect: (context: PluginContext): Promise<boolean> =>
      Promise.resolve(context.provisioner.isArchiveInstalled(provision)),
    install: (context: PluginContext): Promise<string | null> =>
      context.provisioner.ensureArchive(provision),
    uninstall: (context: PluginContext): Promise<void> =>
      context.provisioner.removeArchive(provision),
  };
}

/**
 * Builds the spawn specification a contributed command describes.
 * @param command The manifest command.
 * @param entryPoint The provisioned entry point.
 * @param context The surface the descriptor resolves through.
 * @returns Returns the resolution.
 */
function toSpec(
  command: ManifestCommand,
  entryPoint: string,
  context: LanguageServerContext,
): LspResolution {
  if (command.kind === 'node') {
    // A JavaScript entry point runs under the runtime Studio ships, so a plugin distributed as a
    // bundle needs no Node on the machine.
    const spec: ReturnType<LanguageServerContext['nodePackageServer']> =
      context.nodePackageServer(entryPoint);
    return resolved({ ...spec, args: [...spec.args, ...(command.args ?? [])], env: command.env });
  }
  return resolved({ command: entryPoint, args: command.args ?? [], env: command.env });
}

/**
 * Turns a manifest's language servers into descriptors the server registry can resolve.
 * @param manifest The validated manifest.
 * @returns Returns the descriptors.
 */
export function toLanguageServerDescriptors(
  manifest: PluginManifest,
): readonly LanguageServerDescriptor[] {
  const provision: ArchiveProvision = toProvision(manifest);
  return (manifest.contributes.languageServers ?? []).map(
    (server: ManifestLanguageServer): LanguageServerDescriptor => ({
      id: server.id,
      displayName: server.displayName,
      languages: server.languages,
      priority: server.priority,
      resolve: (context: LanguageServerContext): LspResolution => {
        const entryPoint: string | null = context.installedPath(provision);
        return entryPoint === null
          ? unavailable(`${server.displayName} is not installed — install it in Plugins.`)
          : toSpec(server.command, entryPoint, context);
      },
    }),
  );
}
