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
 * Resolves a Node-based language server distributed as an npm package into a spawn specification that
 * runs it through the Electron binary in Node mode (`ELECTRON_RUN_AS_NODE`). This avoids depending on
 * a `node` executable being present on the user's PATH and works the same in development and in a
 * packaged application.
 * @param executablePath The absolute path of the Electron binary.
 * @param packageBinPath The absolute path of the server's CLI entry point.
 * @returns Returns the spawn specification.
 */
function nodePackageServer(executablePath: string, packageBinPath: string): LspServerSpec {
  return {
    command: executablePath,
    args: [packageBinPath, '--stdio'],
    env: { ELECTRON_RUN_AS_NODE: '1' },
  };
}

/**
 * Owns the catalogue of known language servers and turns a {@link LspServerId} into a spawn
 * specification. This is the seam that later provisioning work (download/cache, runtime detection,
 * user overrides) grows behind; for now it resolves the bundled TypeScript server only.
 */
export class LspServerRegistry {
  /**
   * Holds the absolute path of the Electron binary, used to run Node-based servers in Node mode.
   */
  private readonly executablePath: string;

  /**
   * Caches resolved npm-package specifications by server identifier, so package resolution happens
   * once. Workspace-scoped servers (such as Java) are not cached here.
   */
  private readonly cache: Map<LspServerId, LspServerSpec | null> = new Map<
    LspServerId,
    LspServerSpec | null
  >();

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
   * its runtime when necessary. A server the user has disabled resolves to null.
   * @param serverId The identifier of the server to resolve.
   * @param rootPath The workspace root the server is rooted at (used for per-workspace data).
   * @returns Returns the spawn specification, or null when the server is unknown, disabled,
   * unavailable, or could not be provisioned.
   */
  public async resolve(serverId: LspServerId, rootPath: string): Promise<LspServerSpec | null> {
    if (this.settings.get().disabledServers.includes(serverId)) {
      return null;
    }
    if (serverId === 'typescript') {
      return this.resolveCached(serverId, (): LspServerSpec | null => this.buildTypescript());
    }
    if (serverId === 'java') {
      return this.buildJava(rootPath);
    }
    return null;
  }

  /**
   * Resolves a server's specification through the cache, building it on first request.
   * @param serverId The server identifier the specification is cached under.
   * @param build Builds the specification when it is not cached.
   * @returns Returns the cached or freshly built specification.
   */
  private resolveCached(
    serverId: LspServerId,
    build: () => LspServerSpec | null,
  ): LspServerSpec | null {
    const cached: LspServerSpec | null | undefined = this.cache.get(serverId);
    if (cached !== undefined) {
      return cached;
    }
    const resolved: LspServerSpec | null = build();
    this.cache.set(serverId, resolved);
    return resolved;
  }

  /**
   * Builds the spawn specification for the bundled TypeScript server.
   * @returns Returns the specification, or null when the package cannot be resolved.
   */
  private buildTypescript(): LspServerSpec | null {
    const binPath: string | null = this.resolveBin('typescript-language-server');
    return binPath === null ? null : nodePackageServer(this.executablePath, binPath);
  }

  /**
   * Builds the spawn specification for the Eclipse JDT Language Server, detecting a Java runtime and
   * downloading the server on first use.
   * @param rootPath The workspace root the server is rooted at.
   * @returns Returns the specification, or null when Java is unavailable or the server could not be
   * provisioned.
   */
  private async buildJava(rootPath: string): Promise<LspServerSpec | null> {
    const java: string | null = await this.provisioner.detectJava(this.settings.get().javaPath);
    if (java === null) {
      return null;
    }
    const install: JdtlsInstall | null = await this.provisioner.ensureJdtls();
    if (install === null) {
      return null;
    }
    const dataDir: string = await this.provisioner.dataDirectory('jdtls', rootPath);
    return {
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
    };
  }

  /**
   * Resolves the CLI entry point of an installed npm package from its `bin` field.
   * @param packageName The package whose CLI entry point is resolved.
   * @returns Returns the absolute path of the entry point, or null when it cannot be resolved.
   */
  private resolveBin(packageName: string): string | null {
    try {
      const manifestPath: string = requireFrom.resolve(`${packageName}/package.json`);
      const manifest: { bin?: string | Record<string, string> } = requireFrom(manifestPath) as {
        bin?: string | Record<string, string>;
      };
      const bin: string | Record<string, string> | undefined = manifest.bin;
      const relative: string | undefined =
        typeof bin === 'string' ? bin : (bin?.[packageName] ?? Object.values(bin ?? {})[0]);
      if (relative === undefined) {
        return null;
      }
      return path.join(path.dirname(manifestPath), relative);
    } catch {
      return null;
    }
  }
}
