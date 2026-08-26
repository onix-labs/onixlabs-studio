import { createRequire } from 'node:module';
import * as path from 'node:path';
import { LspServerId, LspServerSummary } from '@shared/api/lsp-channels';
import { logger } from '../logger';
import { languageServerCatalogue } from './language-server-catalogue';
import {
  LanguageServerContext,
  LanguageServerDescriptor,
  LspResolution,
  LspServerSpec,
  NO_SERVER,
} from './language-server-descriptor';
import { LspProvisioner } from './lsp-provisioner';
import { LspSettingsManager } from './lsp-settings';

export type {
  LanguageServerContext,
  LanguageServerDescriptor,
  LspPostInitialize,
  LspResolution,
  LspServerSpec,
} from './language-server-descriptor';

/**
 * Provides a `require` rooted at this module, used to resolve bundled language-server packages from
 * `node_modules` (the main process is compiled, not bundled, so the dependency tree is on disk).
 */
const requireFrom: NodeRequire = createRequire(__filename);

/**
 * Owns the catalogue of known language servers and turns a {@link LspServerId} into a spawn
 * specification. It is the single seam that provisioning (npm-bundled servers, downloaded servers such
 * as Java), runtime detection, and the user's overrides (disabled servers, a custom Java or TypeScript
 * server path, extra arguments) all sit behind, so the renderer only ever names a server.
 *
 * The catalogue is open: {@link register} accepts a descriptor at runtime, so a contributed server is a
 * peer of the first-party ones rather than a new branch in this class. {@link catalogue} publishes what
 * is registered, which is what lets the user be *offered* a choice of implementation for a language
 * instead of being given a hardcoded one.
 */
export class LspServerRegistry {
  /**
   * Holds the absolute path of the Electron binary, used to run Node-based servers in Node mode.
   */
  private readonly executablePath: string;

  /**
   * Caches resolved npm-package entry points by cache key, so package resolution (a `require.resolve`
   * and manifest read) happens once. Specifications are rebuilt from the cached path on every resolve
   * so they always reflect the current settings (argument overrides and so on).
   */
  private readonly binCache: Map<string, string | null> = new Map<string, string | null>();

  /**
   * Provisions and locates external (non-npm) servers and their runtimes.
   */
  private readonly provisioner: LspProvisioner = new LspProvisioner();

  /**
   * Owns the user's language-server settings (disabled servers, runtime overrides, slot selections).
   */
  private readonly settings: LspSettingsManager;

  /**
   * Indexes the registered descriptors by server id, in registration order (the first-party catalogue
   * first), so ties on priority break deterministically.
   */
  private readonly descriptors: Map<LspServerId, LanguageServerDescriptor> = new Map<
    LspServerId,
    LanguageServerDescriptor
  >();

  /**
   * Initializes a new instance of the {@link LspServerRegistry} class, seeded with the first-party
   * catalogue.
   * @param executablePath The absolute path of the Electron binary (`process.execPath`).
   * @param settings The user's language-server settings.
   */
  public constructor(executablePath: string, settings: LspSettingsManager) {
    this.executablePath = executablePath;
    this.settings = settings;
    for (const descriptor of languageServerCatalogue()) {
      this.register(descriptor);
    }
  }

  /**
   * Registers a language server, replacing any descriptor already registered under the same id. This
   * is the seam a contributed server arrives through; the first-party catalogue uses it too, so there
   * is exactly one registration path.
   * @param descriptor The descriptor to register.
   */
  public register(descriptor: LanguageServerDescriptor): void {
    if (this.descriptors.has(descriptor.id)) {
      logger.info('LspServerRegistry', `Replacing registered server ${descriptor.id}`);
    }
    this.descriptors.set(descriptor.id, descriptor);
  }

  /**
   * Gets the registered servers as plain data, for the renderer to offer the user a choice of
   * implementation per language. Deliberately excludes the resolver: the renderer never needs to know
   * how a server is provisioned, only that it exists and what it serves.
   * @returns Returns the summaries, in registration order.
   */
  public catalogue(): readonly LspServerSummary[] {
    return [...this.descriptors.values()].map(
      (descriptor: LanguageServerDescriptor): LspServerSummary => ({
        id: descriptor.id,
        displayName: descriptor.displayName,
        languages: descriptor.languages,
        priority: descriptor.priority,
      }),
    );
  }

  /**
   * Resolves a server identifier into a spawn specification, provisioning the server and detecting its
   * runtime when necessary. A disabled or unknown server resolves with no specification and no reason;
   * a server that is configured but unavailable resolves with a reason to surface.
   * @param serverId The identifier of the server to resolve.
   * @param rootPath The workspace root the server is rooted at (used for per-workspace data).
   * @returns Returns the resolution.
   */
  public async resolve(serverId: LspServerId, rootPath: string): Promise<LspResolution> {
    logger.trace('LspServerRegistry', `Resolving server ${serverId}`);
    if (this.settings.get().disabledServers.includes(serverId)) {
      logger.debug('LspServerRegistry', `Server ${serverId} is disabled by settings`);
      return NO_SERVER;
    }
    const descriptor: LanguageServerDescriptor | undefined = this.descriptors.get(serverId);
    if (descriptor === undefined) {
      logger.debug('LspServerRegistry', `Unknown server ${serverId}`);
      return NO_SERVER;
    }
    const resolution: LspResolution = await descriptor.resolve(this.context(rootPath));
    return resolution.spec === null
      ? resolution
      : { spec: this.withExtraArgs(serverId, resolution.spec), error: null };
  }

  /**
   * Builds the surface handed to a descriptor when it resolves.
   * @param rootPath The workspace root the server is being resolved for.
   * @returns Returns the context.
   */
  private context(rootPath: string): LanguageServerContext {
    return {
      rootPath,
      settings: this.settings,
      provisioner: this.provisioner,
      nodePackageServer: (packageBinPath: string): LspServerSpec =>
        this.nodePackageServer(packageBinPath),
      packageBin: (packageName: string, binName?: string): string | null =>
        this.cachedBin(packageName, binName ?? packageName),
    };
  }

  /**
   * Builds a spawn specification for a Node-based language server distributed as an npm package,
   * running it through the Electron binary in Node mode (`ELECTRON_RUN_AS_NODE`). This avoids
   * depending on a `node` executable being present on the user's PATH and works the same in
   * development and in a packaged application.
   * @param packageBinPath The absolute path of the server's CLI entry point.
   * @returns Returns the spawn specification.
   */
  private nodePackageServer(packageBinPath: string): LspServerSpec {
    return {
      command: this.executablePath,
      args: [packageBinPath, '--stdio'],
      env: { ELECTRON_RUN_AS_NODE: '1' },
    };
  }

  /**
   * Appends the user's argument overrides for a server to a spawn specification.
   * @param serverId The server identifier whose overrides are applied.
   * @param spec The base spawn specification.
   * @returns Returns the specification with any extra arguments appended.
   */
  private withExtraArgs(serverId: LspServerId, spec: LspServerSpec): LspServerSpec {
    const extra: readonly string[] | undefined = this.settings.get().serverArgs[serverId];
    if (extra === undefined || extra.length === 0) {
      return spec;
    }
    return { ...spec, args: [...spec.args, ...extra] };
  }

  /**
   * Resolves an npm package's CLI entry point, caching the result so resolution happens once.
   * @param packageName The package whose CLI entry point is resolved.
   * @param binName The named `bin` entry to resolve, defaulting to the package name.
   * @returns Returns the absolute path of the entry point, or null when it cannot be resolved.
   */
  private cachedBin(packageName: string, binName: string = packageName): string | null {
    const key: string = `${packageName}::${binName}`;
    if (this.binCache.has(key)) {
      return this.binCache.get(key) ?? null;
    }
    const resolvedBin: string | null = this.resolveBin(packageName, binName);
    this.binCache.set(key, resolvedBin);
    return resolvedBin;
  }

  /**
   * Resolves the CLI entry point of an installed npm package from its `bin` field.
   * @param packageName The package whose CLI entry point is resolved.
   * @param binName The named `bin` entry to resolve, defaulting to the package name.
   * @returns Returns the absolute path of the entry point, or null when it cannot be resolved.
   */
  private resolveBin(packageName: string, binName: string = packageName): string | null {
    try {
      const manifestPath: string = requireFrom.resolve(`${packageName}/package.json`);
      const manifest: { bin?: string | Record<string, string> } = requireFrom(manifestPath) as {
        bin?: string | Record<string, string>;
      };
      const bin: string | Record<string, string> | undefined = manifest.bin;
      const relative: string | undefined =
        typeof bin === 'string' ? bin : (bin?.[binName] ?? Object.values(bin ?? {})[0]);
      if (relative === undefined) {
        return null;
      }
      return path.join(path.dirname(manifestPath), relative);
    } catch (error: unknown) {
      logger.error(
        'LspServerRegistry',
        `Failed to resolve npm server bin for ${packageName}`,
        error,
      );
      return null;
    }
  }
}
