import { DebugAdapterId, DebugAdapterSummary } from '@shared/api/debug-channels';
import { debugpyInterpreter } from './debugpy-install';
import { logger } from '../logger';
import { contributedDebugAdapters } from '../contributions/plugins/contributed';
import { DebugProvisioner } from './debug-provisioner';

/**
 * The priority given to the adapter shipped as a language's default, chosen when the user has
 * expressed no preference.
 */
const DEFAULT_PRIORITY: number = 100;

/**
 * Describes how to spawn a debug adapter. The command and arguments are decided entirely by the main
 * process; the renderer only ever names an adapter by its {@link DebugAdapterId}. Mirrors the LSP
 * layer's `LspServerSpec`.
 */
export interface DebugAdapterSpec {
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
   * Gets how the adapter is spoken to: `stdio` spawns it and uses its standard streams (netcoredbg);
   * `tcp-server` spawns a debug server and connects over TCP, hosting a tree of sessions (js-debug).
   * Defaults to `stdio` when omitted.
   */
  readonly transport?: 'stdio' | 'tcp-server';
}

/**
 * The outcome of resolving an adapter: the spawn specification when it is available, otherwise a
 * human-readable reason it is not (so the renderer can explain why a session did not start), or no
 * reason when the adapter is simply unknown. Mirrors the LSP layer's `LspResolution`.
 */
export interface DebugAdapterResolution {
  /**
   * Gets the spawn specification, or null when the adapter could not be resolved.
   */
  readonly spec: DebugAdapterSpec | null;

  /**
   * Gets a human-readable reason the adapter is unavailable, or null when there is none to surface
   * (an unknown adapter id).
   */
  readonly error: string | null;
}

/**
 * Describes a registered adapter: the executable to locate and how to turn its resolved path into a
 * spawn specification. Contributed adapters are described by exactly this shape — a manifest is turned
 * into one of these — so a plugin's adapter is a peer of the built-in one rather than a special case.
 */
export interface DebugAdapterCatalogueEntry {
  /**
   * Gets the adapter identifier a provider's debug capability names.
   */
  readonly id: DebugAdapterId;

  /**
   * Gets the display name of the adapter.
   */
  readonly displayName: string;

  /**
   * Gets the name of the executable to locate on the PATH (or via an override) for this adapter.
   */
  readonly binary: string;

  /**
   * Gets the languages this adapter debugs. A language with more than one adapter is a slot the user
   * chooses an implementation for; a project system's declared adapter is the default for its
   * language, not the only possibility.
   */
  readonly languages: readonly string[];

  /**
   * Gets the priority used to pick a default when the user has expressed no preference, higher first.
   * Ties break on catalogue order, so a deterministic default always exists.
   */
  readonly priority: number;

  /**
   * Locates an adapter that is neither on the PATH nor a downloadable archive — debugpy lives in a
   * managed virtual environment, so it knows where to look for itself. Tried before the PATH search, so
   * the copy the Plugin Manager installed wins over whatever else is on the machine.
   * @returns Returns the executable path, or null when the adapter is not installed.
   */
  readonly locate?: () => Promise<string | null>;

  /**
   * Builds the spawn specification from the located executable path.
   * @param binaryPath The absolute path of the located executable.
   * @returns Returns the spawn specification.
   */
  readonly buildSpec: (binaryPath: string) => DebugAdapterSpec;
}

/**
 * The built-in debug adapters — what is left of them.
 *
 * Core owns the protocol client, not the adapters: netcoredbg and js-debug are plugins in the curated
 * index, obtained and started from data. Only debugpy remains described in code, because installing it
 * means creating a managed Python environment, which no manifest can express without executing
 * something at install time.
 *
 * @returns Returns the catalogue entries.
 */
export function debugAdapterCatalogue(): readonly DebugAdapterCatalogueEntry[] {
  return [
    {
      id: 'debugpy',
      displayName: 'Python (debugpy)',
      binary: 'debugpy',
      languages: ['python'],
      priority: DEFAULT_PRIORITY,
      // debugpy is a Python package rather than a binary, so it ships no archive recipe: the Plugin
      // Manager installs it into a managed virtual environment and this finds it there. Verified to
      // speak DAP over stdio from `python -m debugpy.adapter`, which is how VS Code drives it too.
      locate: (): Promise<string | null> => Promise.resolve(debugpyInterpreter()),
      buildSpec: (interpreter: string): DebugAdapterSpec => ({
        command: interpreter,
        args: ['-m', 'debugpy.adapter'],
      }),
    },
  ];
}

/**
 * Owns the catalogue of known debug adapters and turns a {@link DebugAdapterId} into a spawn
 * specification, locating each adapter's executable through the {@link DebugProvisioner}. It is the
 * single seam that the adapter catalogue and executable detection sit behind, so the renderer only ever
 * names an adapter — mirroring the role `LspServerRegistry` plays for language servers.
 *
 * It never obtains an adapter. What is installed is decided by the Plugin Manager, so resolving is a
 * question of finding what an install already put on disk.
 */
export class DebugAdapterRegistry {
  /**
   * Locates adapter executables already present on the machine.
   */
  private readonly provisioner: DebugProvisioner;

  /**
   * Indexes the registered adapters by id, in registration order (the first-party catalogue first), so
   * ties on priority break deterministically.
   */
  private readonly entries: Map<DebugAdapterId, DebugAdapterCatalogueEntry> = new Map<
    DebugAdapterId,
    DebugAdapterCatalogueEntry
  >();

  /**
   * Initializes a new instance of the {@link DebugAdapterRegistry} class, seeded with the first-party
   * catalogue.
   * @param provisioner The provisioner used to locate adapter executables.
   */
  public constructor(provisioner: DebugProvisioner) {
    this.provisioner = provisioner;
    for (const entry of debugAdapterCatalogue()) {
      this.register(entry);
    }
    // Contributed plugins — sideloaded or indexed — register through the same seam a contributed
    // adapter always would: the manifest advertises the contribution point, so it has to actually
    // reach the registry.
    for (const entry of contributedDebugAdapters()) {
      this.register(entry);
    }
  }

  /**
   * Registers a debug adapter, replacing any registered under the same id. This is the seam a
   * contributed adapter arrives through; the first-party catalogue uses it too, so there is exactly one
   * registration path.
   * @param entry The catalogue entry to register.
   */
  public register(entry: DebugAdapterCatalogueEntry): void {
    if (this.entries.has(entry.id)) {
      logger.info('DebugAdapterRegistry', `Replacing registered adapter ${entry.id}`);
    }
    this.entries.set(entry.id, entry);
  }

  /**
   * Gets the registered adapters as plain data, for the renderer to offer the user a choice of
   * implementation per language. Deliberately excludes the spec builder: the renderer never needs to
   * know how an adapter is provisioned, only that it exists and what it debugs.
   * @returns Returns the summaries, in registration order.
   */
  public catalogue(): readonly DebugAdapterSummary[] {
    return [...this.entries.values()].map(
      (entry: DebugAdapterCatalogueEntry): DebugAdapterSummary => ({
        id: entry.id,
        displayName: entry.displayName,
        languages: entry.languages,
        priority: entry.priority,
      }),
    );
  }

  /**
   * Gets whether an adapter id names a registered adapter.
   * @param adapterId The adapter id to test.
   * @returns Returns true when the id is registered.
   */
  public has(adapterId: DebugAdapterId): boolean {
    return this.entries.has(adapterId);
  }

  /**
   * Resolves an adapter id into a spawn specification, locating its executable. An unknown id resolves
   * with no specification and no reason; a known adapter whose executable cannot be found resolves with
   * a reason to surface.
   * @param adapterId The identifier of the adapter to resolve.
   * @param rootPath The absolute workspace root the session is rooted at.
   * @returns Returns the resolution.
   */
  public async resolve(
    adapterId: DebugAdapterId,
    rootPath: string,
  ): Promise<DebugAdapterResolution> {
    const entry: DebugAdapterCatalogueEntry | undefined = this.entries.get(adapterId);
    if (entry === undefined) {
      logger.trace('DebugAdapterRegistry', `Unknown adapter id: ${adapterId}`);
      return { spec: null, error: null };
    }
    logger.trace('DebugAdapterRegistry', `Resolving adapter ${adapterId}`);
    // Ask the adapter where it put itself — an installed plugin's payload, or debugpy's managed
    // environment — and fall back to a copy already on the machine (override, project-local, or PATH).
    // Nothing is downloaded here: an adapter arrives through an install the user asked for.
    const binaryPath: string | null =
      (await entry.locate?.()) ?? (await this.provisioner.locate(entry.binary, rootPath));
    logger.debug('DebugAdapterRegistry', `Located ${entry.binary}: ${binaryPath ?? 'not found'}`);
    if (binaryPath === null) {
      logger.warn(
        'DebugAdapterRegistry',
        `${entry.displayName} adapter (${entry.binary}) could not be found or installed`,
      );
      return {
        spec: null,
        error: `The ${entry.displayName} debug adapter (${entry.binary}) could not be found or installed.`,
      };
    }
    logger.debug('DebugAdapterRegistry', `Resolved ${adapterId} to ${binaryPath}`);
    return { spec: entry.buildSpec(binaryPath), error: null };
  }
}
