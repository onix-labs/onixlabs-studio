import { DebugAdapterId } from '@shared/api/debug-channels';
import { DebugProvisioner } from './debug-provisioner';

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
 * Describes a built-in adapter in the closed catalogue: the executable to locate and how to turn its
 * resolved path into a spawn specification.
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
   * Builds the spawn specification from the located executable path.
   * @param binaryPath The absolute path of the located executable.
   * @returns Returns the spawn specification.
   */
  readonly buildSpec: (binaryPath: string) => DebugAdapterSpec;
}

/**
 * The closed catalogue of built-in debug adapters. Kept closed (a fixed list, not an open `register()`)
 * to match the LSP server registry; runtime-contributed adapters are the deferred plugin epic's
 * concern. The Node adapter (js-debug) and netcoredbg's provisioning recipe are wired in a later phase;
 * this phase establishes the mechanism and the one adapter whose invocation is stable and known.
 *
 * @returns Returns the catalogue entries.
 */
export function debugAdapterCatalogue(): readonly DebugAdapterCatalogueEntry[] {
  return [
    {
      id: 'netcoredbg',
      displayName: '.NET (netcoredbg)',
      binary: 'netcoredbg',
      // netcoredbg speaks DAP over stdio in its VS Code interpreter mode. Microsoft's `vsdbg` is
      // deliberately not offered: it is licensed only for use within the Visual Studio family, whereas
      // netcoredbg (Samsung) is MIT-licensed.
      buildSpec: (binaryPath: string): DebugAdapterSpec => ({
        command: binaryPath,
        args: ['--interpreter=vscode'],
      }),
    },
  ];
}

/**
 * Owns the catalogue of known debug adapters and turns a {@link DebugAdapterId} into a spawn
 * specification, locating each adapter's executable through the {@link DebugProvisioner}. It is the
 * single seam that the adapter catalogue, executable detection, and (in a later phase) provisioning all
 * sit behind, so the renderer only ever names an adapter — mirroring the role `LspServerRegistry` plays
 * for language servers.
 */
export class DebugAdapterRegistry {
  /**
   * Locates and (in a later phase) installs adapter executables.
   */
  private readonly provisioner: DebugProvisioner;

  /**
   * Indexes the catalogue entries by adapter id.
   */
  private readonly entries: ReadonlyMap<DebugAdapterId, DebugAdapterCatalogueEntry>;

  /**
   * Initializes a new instance of the {@link DebugAdapterRegistry} class.
   * @param provisioner The provisioner used to locate adapter executables.
   */
  public constructor(provisioner: DebugProvisioner) {
    this.provisioner = provisioner;
    this.entries = new Map<DebugAdapterId, DebugAdapterCatalogueEntry>(
      debugAdapterCatalogue().map(
        (entry: DebugAdapterCatalogueEntry): [DebugAdapterId, DebugAdapterCatalogueEntry] => [
          entry.id,
          entry,
        ],
      ),
    );
  }

  /**
   * Gets whether an adapter id names a built-in adapter.
   * @param adapterId The adapter id to test.
   * @returns Returns true when the id is in the catalogue.
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
      return { spec: null, error: null };
    }
    const binaryPath: string | null = await this.provisioner.locate(entry.binary, rootPath);
    if (binaryPath === null) {
      return {
        spec: null,
        error: `The ${entry.displayName} debug adapter (${entry.binary}) could not be found.`,
      };
    }
    return { spec: entry.buildSpec(binaryPath), error: null };
  }
}
