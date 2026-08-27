import { existsSync, readdirSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import {
  ManifestCommand,
  ManifestDebugAdapter,
  ManifestDownload,
  ManifestError,
  ManifestLanguageServer,
  ManifestRequirement,
  ManifestResult,
  parsePluginManifest,
  PluginManifest,
} from '@shared/api/plugin-manifest';
import { PluginContribution, PluginOrigin } from '@shared/api/plugin-channels';
import { logger } from '../../logger';
import {
  LanguageServerContext,
  LanguageServerDescriptor,
  LspResolution,
  resolved,
  unavailable,
} from '../../lsp/language-server-descriptor';
import { DebugAdapterCatalogueEntry, DebugAdapterSpec } from '../../debug/debug-adapter-registry';
import { ArchiveDownload, ArchiveProvision } from '../../provisioning/archive-provision';
import {
  LockfilePackage,
  LockfileProvision,
  parseLockfileDocument,
} from '../../provisioning/lockfile-provision';
import { LspProvisioner } from '../../lsp/lsp-provisioner';
import { PluginContext, PluginDescriptor } from './plugin-catalogue';
import { bundledLockfile } from './bundled-lockfiles';

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
 * @returns Returns the provisioning recipe, or null when the plugin is not archive-provisioned.
 */
export function toProvision(manifest: PluginManifest): ArchiveProvision | null {
  if (manifest.provision.kind !== 'archive') {
    return null;
  }
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
 * Turns a manifest's provisioning into the recipe the lockfile provisioner installs from.
 * @param manifest The validated manifest.
 * @returns Returns the provisioning recipe, or null when the plugin is not npm-provisioned.
 */
export function toTreeProvision(manifest: PluginManifest): LockfileProvision | null {
  if (manifest.provision.kind !== 'npm') {
    return null;
  }
  return {
    id: manifest.id,
    version: manifest.version,
    lockfileUrl: manifest.provision.lockfileUrl,
    sha256: manifest.provision.sha256,
    executablePath: manifest.provision.executablePath,
  };
}

/**
 * The four questions every consumer asks of a plugin's payload, whichever way it is provisioned.
 *
 * The two kinds answer them differently but nothing downstream should care: a descriptor asks whether
 * its plugin is installed, not whether it is an archive. Resolving the kind once, here, is what keeps
 * that branch out of the descriptors, the language servers and the debug adapters alike.
 */
export interface PayloadOps {
  /**
   * Gets the entry point the payload installs to, whether or not it is installed yet.
   */
  target(provisioner: LspProvisioner): string | null;

  /**
   * Gets whether the payload is installed, without downloading anything.
   */
  isInstalled(provisioner: LspProvisioner): boolean;

  /**
   * Installs the payload, or reuses the cached install.
   */
  ensure(provisioner: LspProvisioner): Promise<string | null>;

  /**
   * Removes the payload's install.
   */
  remove(provisioner: LspProvisioner): Promise<void>;
}

/**
 * Gets the host of a URL, or null when it cannot be read as one.
 * @param url The URL.
 * @returns Returns the host, or null.
 */
function hostOf(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

/**
 * Describes where a manifest's payload is fetched from, for the consent step.
 *
 * Read off the pinned URLs rather than taken from anything the manifest asserts about itself. For an
 * npm provision the package count is the whole tree, which is the number worth showing: the entry
 * names one publisher, and a dependency tree is written by many more people than that.
 *
 * The count comes from the lockfile compiled into the application, because this is answered
 * synchronously while listing plugins and must never trigger a download. A plugin whose lockfile is
 * only published reports no count rather than a wrong one.
 * @param manifest The validated manifest.
 * @param bundled Resolves a compiled-in lockfile for a URL.
 * @returns Returns the origin, or undefined when it cannot be described.
 */
export function toOrigin(
  manifest: PluginManifest,
  bundled: (url: string) => unknown = (): null => null,
): PluginOrigin | undefined {
  if (manifest.provision.kind === 'archive') {
    const hosts: string[] = [];
    for (const download of Object.values(manifest.provision.downloads)) {
      const host: string | null = hostOf(download.url);
      if (host !== null && !hosts.includes(host)) {
        hosts.push(host);
      }
    }
    return { hosts, packageCount: 1 };
  }
  const packages: readonly LockfilePackage[] | null = parseLockfileDocument(
    bundled(manifest.provision.lockfileUrl),
  );
  if (packages === null) {
    return undefined;
  }
  const hosts: string[] = [];
  for (const entry of packages) {
    const host: string | null = hostOf(entry.url);
    if (host !== null && !hosts.includes(host)) {
      hosts.push(host);
    }
  }
  return { hosts, packageCount: packages.length };
}

/**
 * Binds a manifest's provisioning to the provisioner calls that serve it.
 * @param manifest The validated manifest.
 * @returns Returns the operations for the manifest's provisioning kind.
 */
export function payloadOps(manifest: PluginManifest): PayloadOps {
  const tree: LockfileProvision | null = toTreeProvision(manifest);
  if (tree !== null) {
    return {
      target: (p: LspProvisioner): string | null => p.treeTarget(tree),
      isInstalled: (p: LspProvisioner): boolean => p.isTreeInstalled(tree),
      ensure: (p: LspProvisioner): Promise<string | null> => p.ensureTree(tree),
      remove: (p: LspProvisioner): Promise<void> => p.removeTree(tree),
    };
  }
  const archive: ArchiveProvision | null = toProvision(manifest);
  if (archive === null) {
    // Unreachable while the manifest has two kinds and both are handled, but a third would otherwise
    // arrive here as a plugin that silently claims to be installed.
    return {
      target: (): string | null => null,
      isInstalled: (): boolean => false,
      ensure: (): Promise<string | null> => Promise.resolve(null),
      remove: (): Promise<void> => Promise.resolve(),
    };
  }
  return {
    target: (p: LspProvisioner): string | null => p.archiveTarget(archive),
    isInstalled: (p: LspProvisioner): boolean => p.isArchiveInstalled(archive),
    ensure: (p: LspProvisioner): Promise<string | null> => p.ensureArchive(archive),
    remove: (p: LspProvisioner): Promise<void> => p.removeArchive(archive),
  };
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
 * Builds the note shown alongside a plugin before it is installed.
 *
 * What the manifest says wins, because a plugin author knows things about their plugin that no rule
 * could derive — that a download is large, that a server needs configuring before it is useful. Failing
 * that, the runtimes it declares are worth saying on their own: a plugin that needs a JDK is better
 * described as needing one than described as nothing.
 * @param manifest The validated manifest.
 * @returns Returns the note, or undefined when there is nothing to say.
 */
export function toDetail(manifest: PluginManifest): string | undefined {
  if (manifest.detail !== undefined) {
    return manifest.detail;
  }
  const requires: string = manifest.requires
    .map((requirement: ManifestRequirement): string =>
      requirement.minimumVersion === undefined
        ? requirement.runtime
        : `${requirement.runtime} ${requirement.minimumVersion}+`,
    )
    .join(', ');
  return requires.length === 0 ? undefined : `Needs ${requires} to run once installed.`;
}

/**
 * Turns a validated manifest into a plugin the Plugin Manager can install and remove, exactly like a
 * first-party one. A sideloaded plugin is not a special case: it is a catalogue entry that happened to
 * arrive as data rather than as code.
 * @param manifest The validated manifest.
 * @returns Returns the descriptor.
 */
export function toPluginDescriptor(manifest: PluginManifest): PluginDescriptor {
  const ops: PayloadOps = payloadOps(manifest);
  return {
    id: manifest.id,
    name: manifest.name,
    description: manifest.description,
    version: manifest.version,
    contributions: toContributions(manifest),
    detail: toDetail(manifest),
    origin: toOrigin(manifest, bundledLockfile),
    supported: (context: PluginContext): boolean => ops.target(context.provisioner) !== null,
    detect: (context: PluginContext): Promise<boolean> =>
      Promise.resolve(ops.isInstalled(context.provisioner)),
    install: (context: PluginContext): Promise<string | null> => ops.ensure(context.provisioner),
    uninstall: (context: PluginContext): Promise<void> => ops.remove(context.provisioner),
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
  const ops: PayloadOps = payloadOps(manifest);
  return (manifest.contributes.languageServers ?? []).map(
    (server: ManifestLanguageServer): LanguageServerDescriptor => ({
      id: server.id,
      displayName: server.displayName,
      languages: server.languages,
      priority: server.priority,
      resolve: (context: LanguageServerContext): LspResolution => {
        // Never installs: a server resolves to "not installed" and the user installs it in the Plugin
        // Manager, rather than opening a file silently triggering a large download.
        const entryPoint: string | null = ops.isInstalled(context.provisioner)
          ? ops.target(context.provisioner)
          : null;
        return entryPoint === null
          ? unavailable(`${server.displayName} is not installed — install it in Plugins.`)
          : toSpec(server.command, entryPoint, context);
      },
    }),
  );
}

/**
 * Turns a manifest's debug adapters into catalogue entries the debug registry can resolve.
 *
 * The adapter lives inside the same payload as everything else the plugin contributes — a plugin is one
 * payload however many things it provides — so it is located by asking where that payload was installed
 * rather than by searching the PATH.
 * @param manifest The validated manifest.
 * @param provisioner Gets the provisioner the plugin's install went through, so the answer cannot
 * disagree with where the payload actually landed.
 * @returns Returns the catalogue entries.
 */
export function toDebugAdapterEntries(
  manifest: PluginManifest,
  provisioner: () => LspProvisioner,
): readonly DebugAdapterCatalogueEntry[] {
  const ops: PayloadOps = payloadOps(manifest);
  return (manifest.contributes.debugAdapters ?? []).map(
    (adapter: ManifestDebugAdapter): DebugAdapterCatalogueEntry => ({
      id: adapter.id,
      displayName: adapter.displayName,
      // Only used for the PATH search the registry falls back to; `locate` answers first, so this
      // never decides anything for a contributed adapter.
      binary: adapter.id,
      languages: adapter.languages,
      priority: adapter.priority,
      locate: (): Promise<string | null> =>
        Promise.resolve(ops.isInstalled(provisioner()) ? ops.target(provisioner()) : null),
      buildSpec: (entryPoint: string): DebugAdapterSpec =>
        adapter.command.kind === 'node'
          ? {
              command: process.execPath,
              args: [entryPoint, ...(adapter.command.args ?? [])],
              env: { ELECTRON_RUN_AS_NODE: '1', ...(adapter.command.env ?? {}) },
              transport: adapter.transport,
            }
          : {
              command: entryPoint,
              args: adapter.command.args ?? [],
              env: adapter.command.env,
              transport: adapter.transport,
            },
    }),
  );
}
