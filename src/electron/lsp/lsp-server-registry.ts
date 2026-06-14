import { createRequire } from 'node:module';
import * as path from 'node:path';
import { LspServerId } from '../../shared/lsp-types';

/**
 * Provides a `require` rooted at this module, used to resolve bundled language-server packages from
 * `node_modules` (the main process is compiled, not bundled, so the dependency tree is on disk).
 */
const requireFrom: NodeRequire = createRequire(__filename);

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
   * Caches resolved specifications by server identifier, so package resolution happens once.
   */
  private readonly cache: Map<LspServerId, LspServerSpec | null> = new Map<
    LspServerId,
    LspServerSpec | null
  >();

  /**
   * Initializes a new instance of the {@link LspServerRegistry} class.
   * @param executablePath The absolute path of the Electron binary (`process.execPath`).
   */
  public constructor(executablePath: string) {
    this.executablePath = executablePath;
  }

  /**
   * Resolves a server identifier into a spawn specification.
   * @param serverId The identifier of the server to resolve.
   * @returns Returns the spawn specification, or null when the identifier is unknown or its package
   * cannot be resolved.
   */
  public resolve(serverId: LspServerId): LspServerSpec | null {
    const cached: LspServerSpec | null | undefined = this.cache.get(serverId);
    if (cached !== undefined) {
      return cached;
    }
    const resolved: LspServerSpec | null = this.build(serverId);
    this.cache.set(serverId, resolved);
    return resolved;
  }

  /**
   * Builds the spawn specification for a server identifier without consulting the cache.
   * @param serverId The identifier of the server to build.
   * @returns Returns the spawn specification, or null when unsupported or unresolvable.
   */
  private build(serverId: LspServerId): LspServerSpec | null {
    if (serverId === 'typescript') {
      const binPath: string | null = this.resolveBin('typescript-language-server');
      return binPath === null ? null : nodePackageServer(this.executablePath, binPath);
    }
    return null;
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
