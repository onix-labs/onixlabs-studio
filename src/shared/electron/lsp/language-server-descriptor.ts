import { LspServerId } from '@shared/api/lsp-channels';
import { ArchiveProvision } from '../provisioning/archive-provision';
import { logger } from '../logger';
import { LspProvisioner } from './lsp-provisioner';
import { LspSettingsManager } from './lsp-settings';

/**
 * Describes a notification the manager sends to a server immediately after the `initialized`
 * handshake, before forwarding renderer traffic. Used by servers that do not load a workspace from
 * `rootUri` alone and must be told which solution or project to open (such as the Roslyn C# server).
 */
export interface LspPostInitialize {
  /**
   * Gets the LSP notification method to send.
   */
  readonly method: string;

  /**
   * Gets the notification parameters.
   */
  readonly params: unknown;
}

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

  /**
   * Gets the notifications to send immediately after the `initialized` handshake, or undefined when
   * the server needs none.
   */
  readonly postInitialize?: readonly LspPostInitialize[];
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
export const NO_SERVER: LspResolution = { spec: null, error: null };

/**
 * Builds a successful resolution from a spawn specification.
 * @param spec The spawn specification.
 * @returns Returns the resolution.
 */
export function resolved(spec: LspServerSpec): LspResolution {
  return { spec, error: null };
}

/**
 * Builds a failed resolution carrying a reason to surface to the user.
 * @param error The human-readable reason the server is unavailable.
 * @returns Returns the resolution.
 */
export function unavailable(error: string): LspResolution {
  logger.warn('LanguageServer', `Server unavailable: ${error}`);
  return { spec: null, error };
}

/**
 * The surface a {@link LanguageServerDescriptor} is handed when it resolves: the workspace it is being
 * resolved for, the user's settings, the provisioner that downloads and detects runtimes, and the
 * helpers that turn a located entry point into a spawn specification. A descriptor reaches the
 * application through this context and nothing else, so the catalogue stays free of construction
 * details and is unit-testable against a stub.
 */
export interface LanguageServerContext {
  /**
   * Gets the workspace root the server is being resolved for (used for per-workspace data
   * directories and for project models a server must be told to open).
   */
  readonly rootPath: string;

  /**
   * Gets the user's language-server settings (runtime path overrides and the like).
   */
  readonly settings: LspSettingsManager;

  /**
   * Gets the provisioner that downloads external servers and detects their runtimes.
   */
  readonly provisioner: LspProvisioner;

  /**
   * Builds a spawn specification for a Node-based server distributed as an npm package, running it
   * through the Electron binary in Node mode so no `node` executable need be on the user's PATH.
   * @param packageBinPath The absolute path of the server's CLI entry point.
   * @returns Returns the spawn specification.
   */
  nodePackageServer(packageBinPath: string): LspServerSpec;

  /**
   * Gets the path a provisioned component was installed to, or null when it is not installed. Never
   * installs: a server resolves to "not installed" and the user installs it in the Plugin Manager,
   * rather than opening a file silently triggering a large download.
   * @param provision The provisioning recipe.
   * @returns Returns the installed path, or null when it is not installed.
   */
  installedPath(provision: ArchiveProvision): string | null;
}

/**
 * Describes one language server implementation the application can run — the unit a slot is filled
 * with. A descriptor is data plus a resolver: everything the catalogue needs to *offer* the server to
 * the user (its identity, display name, and the languages it serves) is plain data, so the renderer's
 * picker and any future manifest format can read it; {@link resolve} is the first-party escape hatch
 * for provisioning logic a declarative manifest cannot express.
 */
export interface LanguageServerDescriptor {
  /**
   * Gets the stable identifier the renderer names this server by.
   */
  readonly id: LspServerId;

  /**
   * Gets the display name shown to the user when choosing which server serves a language.
   */
  readonly displayName: string;

  /**
   * Gets the Monaco language identifiers this server can serve. A language with more than one
   * descriptor is a slot the user chooses an implementation for.
   */
  readonly languages: readonly string[];

  /**
   * Gets the priority used to pick a default when the user has expressed no preference, higher first.
   * Ties break on catalogue order, so a deterministic default always exists.
   */
  readonly priority: number;

  /**
   * Resolves the server into a spawn specification, provisioning it and detecting its runtime when
   * necessary.
   * @param context The surface the descriptor reaches the application through.
   * @returns Returns the resolution.
   */
  resolve(context: LanguageServerContext): LspResolution | Promise<LspResolution>;
}
