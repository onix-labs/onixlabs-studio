import { DebugAdapterId } from '@shared/api/debug-channels';
import { DebugAdapterDownload, DebugAdapterProvision, DebugProvisioner } from './debug-provisioner';

/**
 * The pinned netcoredbg releases. Upstream stopped publishing an osx-amd64 build after 3.1.3, and does
 * not publish osx-arm64 before 3.2.0, so the two macOS architectures are pinned to different releases;
 * every other platform tracks 3.2.0. Bump both together when updating.
 */
const NETCOREDBG_BASE: string = 'https://github.com/Samsung/netcoredbg/releases/download';

/**
 * The netcoredbg provisioning recipe: one pinned, checksum-verified archive per supported platform. The
 * executable and its managed assemblies live under a `netcoredbg/` directory inside each archive.
 */
const NETCOREDBG_PROVISION: DebugAdapterProvision = {
  id: 'netcoredbg',
  version: '3.2.0-1092',
  downloads: {
    'darwin-arm64': {
      url: `${NETCOREDBG_BASE}/3.2.0-1092/netcoredbg-osx-arm64.zip`,
      sha256: 'f4fa33b3ff874910cc184b4bb3b9c56d0abdf5c6521cee0b144d7c6e4a6e59ea',
      archive: 'zip',
      executablePath: 'netcoredbg/netcoredbg',
    },
    'darwin-x64': {
      url: `${NETCOREDBG_BASE}/3.1.3-1062/netcoredbg-osx-amd64.tar.gz`,
      sha256: '49459b066836b6a452f418501d7ecab57bcd7e60d8464faac21ff70b496b8634',
      archive: 'tar.gz',
      executablePath: 'netcoredbg/netcoredbg',
    },
    'linux-x64': {
      url: `${NETCOREDBG_BASE}/3.2.0-1092/netcoredbg-linux-amd64.tar.gz`,
      sha256: '080eb3b2d2152465f599d3b33d1ee6e747794e11cc0a3773ec689f5e5f2c5afa',
      archive: 'tar.gz',
      executablePath: 'netcoredbg/netcoredbg',
    },
    'linux-arm64': {
      url: `${NETCOREDBG_BASE}/3.2.0-1092/netcoredbg-linux-arm64.tar.gz`,
      sha256: '065ff49badec8a695dbea2de6ab6a330c774a191e426a217ab8cc05250627ccb',
      archive: 'tar.gz',
      executablePath: 'netcoredbg/netcoredbg',
    },
    'win32-x64': {
      url: `${NETCOREDBG_BASE}/3.2.0-1092/netcoredbg-win64.zip`,
      sha256: '3c410a45fa502415203a94fcb88654af65bf8e3dac158a5527a722e7a6b9274a',
      archive: 'zip',
      executablePath: 'netcoredbg/netcoredbg.exe',
    },
  },
};

/**
 * js-debug (Microsoft's Node/Chrome debugger) ships as a platform-independent bundle of JavaScript, so
 * every platform downloads the same checksum-verified archive; the debug server is a script inside it,
 * run under the Node runtime.
 */
const JS_DEBUG_BASE: string = 'https://github.com/microsoft/vscode-js-debug/releases/download';

/**
 * The one js-debug archive, reused for every platform (its contents are pure JavaScript).
 */
const JS_DEBUG_DOWNLOAD: DebugAdapterDownload = {
  url: `${JS_DEBUG_BASE}/v1.117.0/js-debug-dap-v1.117.0.tar.gz`,
  sha256: 'ad8d04ede9d4b75cc290fd5438a65047a06f786d04f604b6112485b36f090772',
  archive: 'tar.gz',
  executablePath: 'js-debug/src/dapDebugServer.js',
};

/**
 * The js-debug provisioning recipe: the same pinned, checksum-verified archive for every supported
 * platform, since the bundle is platform-independent JavaScript.
 */
const JS_DEBUG_PROVISION: DebugAdapterProvision = {
  id: 'js-debug',
  version: '1.117.0',
  downloads: {
    'darwin-arm64': JS_DEBUG_DOWNLOAD,
    'darwin-x64': JS_DEBUG_DOWNLOAD,
    'linux-x64': JS_DEBUG_DOWNLOAD,
    'linux-arm64': JS_DEBUG_DOWNLOAD,
    'win32-x64': JS_DEBUG_DOWNLOAD,
  },
};

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
   * Gets the provisioning recipe for an adapter that ships as a downloadable binary, or undefined for an
   * adapter expected to be found on the PATH or via an override.
   */
  readonly provision?: DebugAdapterProvision;

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
 * concern. netcoredbg ships a pinned, checksum-verified download recipe ({@link NETCOREDBG_PROVISION});
 * the Node adapter (js-debug) is wired in a later phase.
 *
 * @returns Returns the catalogue entries.
 */
export function debugAdapterCatalogue(): readonly DebugAdapterCatalogueEntry[] {
  return [
    {
      id: 'netcoredbg',
      displayName: '.NET (netcoredbg)',
      binary: 'netcoredbg',
      provision: NETCOREDBG_PROVISION,
      // netcoredbg speaks DAP over stdio in its VS Code interpreter mode. Microsoft's `vsdbg` is
      // deliberately not offered: it is licensed only for use within the Visual Studio family, whereas
      // netcoredbg (Samsung) is MIT-licensed.
      buildSpec: (binaryPath: string): DebugAdapterSpec => ({
        command: binaryPath,
        args: ['--interpreter=vscode'],
      }),
    },
    {
      id: 'js-debug',
      displayName: 'Node (js-debug)',
      binary: 'js-debug-dap',
      provision: JS_DEBUG_PROVISION,
      // js-debug is a DAP *server*: run its bundled server script under the current Node runtime (Electron
      // as Node), let it pick a free port (`0`), and connect over TCP. It hosts a parent session plus a
      // child target session per debuggee process — the compound session handles that tree.
      buildSpec: (serverScript: string): DebugAdapterSpec => ({
        command: process.execPath,
        args: [serverScript, '0', '127.0.0.1'],
        env: { ELECTRON_RUN_AS_NODE: '1' },
        transport: 'tcp-server',
      }),
    },
  ];
}

/**
 * Owns the catalogue of known debug adapters and turns a {@link DebugAdapterId} into a spawn
 * specification, locating each adapter's executable through the {@link DebugProvisioner}. It is the
 * single seam that the adapter catalogue, executable detection, and provisioning all sit behind, so the
 * renderer only ever names an adapter — mirroring the role `LspServerRegistry` plays for language
 * servers.
 */
export class DebugAdapterRegistry {
  /**
   * Locates and installs adapter executables.
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
    // Prefer an already-present executable (override, project-local, or PATH); otherwise download the
    // pinned binary if the adapter ships one.
    const located: string | null = await this.provisioner.locate(entry.binary, rootPath);
    const binaryPath: string | null =
      located ?? (entry.provision !== undefined ? await this.provisioner.ensure(entry.provision) : null);
    if (binaryPath === null) {
      return {
        spec: null,
        error: `The ${entry.displayName} debug adapter (${entry.binary}) could not be found or installed.`,
      };
    }
    return { spec: entry.buildSpec(binaryPath), error: null };
  }
}
