import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { LspServerId } from '../../shared/lsp-types';
import { JdtlsInstall, LspProvisioner } from './lsp-provisioner';
import { LspSettingsManager } from './lsp-settings';

/**
 * Provides a `require` rooted at this module, used to resolve bundled language-server packages from
 * `node_modules` (the main process is compiled, not bundled, so the dependency tree is on disk).
 */
const requireFrom: NodeRequire = createRequire(__filename);

/**
 * Holds the JVM arguments passed to the Eclipse JDT Language Server's Equinox launcher, before the
 * launcher JAR, configuration, and data-directory arguments.
 */
const JDTLS_JVM_ARGS: readonly string[] = [
  '-Declipse.application=org.eclipse.jdt.ls.core.id1',
  '-Dosgi.bundles.defaultStartLevel=4',
  '-Declipse.product=org.eclipse.jdt.ls.core.product',
  '-Dlog.level=ALL',
  '-Xmx1G',
  '--add-modules=ALL-SYSTEM',
  '--add-opens',
  'java.base/java.util=ALL-UNNAMED',
  '--add-opens',
  'java.base/java.lang=ALL-UNNAMED',
];

/**
 * Describes how to spawn a language server. The command and arguments are decided entirely by the
 * main process; the renderer only ever names a server by its {@link LspServerId}.
 */
export interface LspServerSpec {
  /**
   * Gets the executable to spawn.
   */
  readonly command: string;

  /**
   * Gets the arguments passed to the executable.
   */
  readonly args: readonly string[];

  /**
   * Gets the environment overlaid on the spawned process's environment, or undefined to inherit the
   * current environment unchanged.
   */
  readonly env?: Readonly<Record<string, string>>;

  /**
   * Gets the initialization options passed to the server's `initialize` request, or undefined when
   * the server needs none.
   */
  readonly initializationOptions?: unknown;
}

/**
 * The outcome of resolving a server: the spawn specification when it is available, otherwise a
 * human-readable reason it is not (so the renderer can explain why a server did not start), or no
 * reason when the server is simply unknown or disabled.
 */
export interface LspResolution {
  /**
   * Gets the spawn specification, or null when the server could not be resolved.
   */
  readonly spec: LspServerSpec | null;

  /**
   * Gets a human-readable reason the server is unavailable, or null when there is none to surface.
   */
  readonly error: string | null;
}

/**
 * Holds a resolution that produced no server and no reason to surface (unknown or disabled server).
 */
const NO_SERVER: LspResolution = { spec: null, error: null };

/**
 * Builds a successful resolution from a spawn specification.
 * @param spec The spawn specification.
 * @returns Returns the resolution.
 */
function resolved(spec: LspServerSpec): LspResolution {
  return { spec, error: null };
}

/**
 * Builds a failed resolution carrying a reason to surface to the user.
 * @param error The human-readable reason the server is unavailable.
 * @returns Returns the resolution.
 */
function unavailable(error: string): LspResolution {
  return { spec: null, error };
}

/**
 * Owns the catalogue of known language servers and turns a {@link LspServerId} into a spawn
 * specification. It is the single seam that provisioning (npm-bundled servers, downloaded servers
 * such as Java), runtime detection, and the user's overrides (disabled servers, a custom Java or
 * TypeScript server path, extra arguments) all sit behind, so the renderer only ever names a server.
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
   * Owns the user's language-server settings (disabled servers, runtime overrides).
   */
  private readonly settings: LspSettingsManager;

  /**
   * Initializes a new instance of the {@link LspServerRegistry} class.
   * @param executablePath The absolute path of the Electron binary (`process.execPath`).
   * @param settings The user's language-server settings.
   */
  public constructor(executablePath: string, settings: LspSettingsManager) {
    this.executablePath = executablePath;
    this.settings = settings;
  }

  /**
   * Resolves a server identifier into a spawn specification, provisioning the server and detecting
   * its runtime when necessary. A disabled or unknown server resolves with no specification and no
   * reason; a server that is configured but unavailable resolves with a reason to surface.
   * @param serverId The identifier of the server to resolve.
   * @param rootPath The workspace root the server is rooted at (used for per-workspace data).
   * @returns Returns the resolution.
   */
  public async resolve(serverId: LspServerId, rootPath: string): Promise<LspResolution> {
    if (this.settings.get().disabledServers.includes(serverId)) {
      return NO_SERVER;
    }
    if (serverId === 'typescript') {
      return this.buildTypescript();
    }
    if (serverId === 'python') {
      return this.buildPython();
    }
    if (serverId === 'java') {
      return this.buildJava(rootPath);
    }
    if (serverId === 'csharp') {
      return this.buildCsharp();
    }
    return NO_SERVER;
  }

  /**
   * Builds the resolution for the TypeScript server, honouring a custom server path when set.
   * @returns Returns the resolution.
   */
  private buildTypescript(): LspResolution {
    const override: string | null = this.settings.get().typescriptServerPath;
    if (override !== null) {
      if (!existsSync(override)) {
        return unavailable(`The TypeScript language server was not found at ${override}.`);
      }
      return resolved(this.withExtraArgs('typescript', this.nodePackageServer(override)));
    }
    const binPath: string | null = this.cachedBin('typescript-language-server');
    return binPath === null
      ? unavailable('The TypeScript language server is not available.')
      : resolved(this.withExtraArgs('typescript', this.nodePackageServer(binPath)));
  }

  /**
   * Builds the resolution for the bundled Python server (Pyright).
   * @returns Returns the resolution.
   */
  private buildPython(): LspResolution {
    const binPath: string | null = this.cachedBin('pyright', 'pyright-langserver');
    return binPath === null
      ? unavailable('The Python language server is not available.')
      : resolved(this.withExtraArgs('python', this.nodePackageServer(binPath)));
  }

  /**
   * Builds the resolution for the Eclipse JDT Language Server, detecting a Java runtime and
   * downloading the server on first use.
   * @param rootPath The workspace root the server is rooted at.
   * @returns Returns the resolution, with a reason when Java is unavailable or the server could not
   * be provisioned.
   */
  private async buildJava(rootPath: string): Promise<LspResolution> {
    const java: string | null = await this.provisioner.detectJava(this.settings.get().javaPath);
    if (java === null) {
      return unavailable('Java 21+ runtime not found — set its path in Settings or install a JDK.');
    }
    const install: JdtlsInstall | null = await this.provisioner.ensureJdtls();
    if (install === null) {
      return unavailable('The Java language server could not be downloaded.');
    }
    const dataDir: string = await this.provisioner.dataDirectory('jdtls', rootPath);
    return resolved(
      this.withExtraArgs('java', {
        command: java,
        args: [
          ...JDTLS_JVM_ARGS,
          '-jar',
          install.launcherJar,
          '-configuration',
          install.configDir,
          '-data',
          dataDir,
        ],
      }),
    );
  }

  /**
   * Builds the resolution for the C# language server (`csharp-ls`), detecting a .NET SDK and
   * installing the server as a .NET tool on first use. The server discovers the project from the
   * workspace root the manager spawns it in.
   * @returns Returns the resolution, with a reason when .NET is unavailable or the server could not be
   * installed.
   */
  private async buildCsharp(): Promise<LspResolution> {
    const dotnet: string | null = await this.provisioner.detectDotnet(
      this.settings.get().dotnetPath,
    );
    if (dotnet === null) {
      return unavailable('.NET SDK not found — set its path in Settings or install the .NET SDK.');
    }
    const server: string | null = await this.provisioner.ensureCsharpLs(dotnet);
    if (server === null) {
      return unavailable('The C# language server (csharp-ls) could not be installed.');
    }
    const spec: LspServerSpec = { command: server, args: [] };
    if (path.isAbsolute(dotnet)) {
      // Help the server's apphost find the runtime when .NET is not on the spawned PATH.
      return resolved({ ...spec, env: { DOTNET_ROOT: path.dirname(dotnet) } });
    }
    return resolved(spec);
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
    } catch {
      return null;
    }
  }
}
