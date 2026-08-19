/**
 * The Ollama release Studio provisions when it manages the binary itself, and the per-platform assets
 * of that release.
 *
 * The version is pinned, and every asset's SHA-256 is the one published in that release's
 * `sha256sum.txt`, hard-coded here rather than fetched: a checksum downloaded from the same place as
 * the archive verifies only that the transfer was intact, not that the release is the one we vetted.
 * This mirrors how {@link import('../../lsp/lsp-provisioner').LspProvisioner} pins its language
 * servers, and for the same reason — this is executable code we are about to run.
 *
 * Bumping {@link OLLAMA_VERSION} means replacing every hash below from the new release's
 * `sha256sum.txt`, and installs into a fresh version-scoped directory.
 */

/**
 * The pinned Ollama release.
 */
export const OLLAMA_VERSION: string = '0.32.14';

/**
 * The base URL of the pinned release's downloadable assets.
 */
export const OLLAMA_RELEASE_BASE: string = `https://github.com/ollama/ollama/releases/download/v${OLLAMA_VERSION}`;

/**
 * One platform's downloadable runtime archive.
 */
export interface OllamaAsset {
  /**
   * The asset's file name within the release.
   */
  readonly name: string;

  /**
   * The asset's published SHA-256, verified before the archive is extracted.
   */
  readonly sha256: string;

  /**
   * How the archive is packed, which decides how it is extracted.
   */
  readonly archive: 'tgz' | 'tar.zst' | 'zip';
}

/**
 * The pinned assets, keyed by `platform-arch`. macOS ships one universal archive, so both
 * architectures resolve to it. The Linux and Windows archives are large (over a gigabyte) because they
 * bundle the GPU runtimes.
 */
const ASSETS: Readonly<Record<string, OllamaAsset>> = {
  'darwin-arm64': {
    name: 'ollama-darwin.tgz',
    sha256: 'c7e8b91485943785bc6d295d96551e971ec94c6829d0d6b3500366942dc50cd1',
    archive: 'tgz',
  },
  'darwin-x64': {
    name: 'ollama-darwin.tgz',
    sha256: 'c7e8b91485943785bc6d295d96551e971ec94c6829d0d6b3500366942dc50cd1',
    archive: 'tgz',
  },
  'linux-x64': {
    name: 'ollama-linux-amd64.tar.zst',
    sha256: 'c620917a71e146ab3a7f893084f066069c4c65d144ef8379a91c3cbe8b27de8f',
    archive: 'tar.zst',
  },
  'linux-arm64': {
    name: 'ollama-linux-arm64.tar.zst',
    sha256: '7802b739fbdc74df556600f1619f86457b69dce913301cf2d91f7f9d7f7a41b8',
    archive: 'tar.zst',
  },
  'win32-x64': {
    name: 'ollama-windows-amd64.zip',
    sha256: '5ae5bca5f0d297f5e35665e01db399a69a8eac3f8fad89cd9d2531fd495c9457',
    archive: 'zip',
  },
  'win32-arm64': {
    name: 'ollama-windows-arm64.zip',
    sha256: '821cdc689f3bb750ab3192fa96189676f8db0eda51e8d01b837ea7581474e1de',
    archive: 'zip',
  },
};

/**
 * Resolves the runtime archive for a platform and architecture.
 * @param platform The Node platform (for example `darwin`).
 * @param arch The Node architecture (for example `arm64`).
 * @returns Returns the asset, or null when Studio cannot provision this platform (the user must
 * install Ollama themselves).
 */
export function ollamaAsset(platform: string, arch: string): OllamaAsset | null {
  return ASSETS[`${platform}-${arch}`] ?? null;
}

/**
 * Resolves the download URL of an asset in the pinned release.
 * @param asset The asset.
 * @returns Returns the absolute download URL.
 */
export function ollamaAssetUrl(asset: OllamaAsset): string {
  return `${OLLAMA_RELEASE_BASE}/${asset.name}`;
}

/**
 * The name of the runtime executable on a platform.
 * @param platform The Node platform.
 * @returns Returns the executable's file name.
 */
export function ollamaExecutableName(platform: string): string {
  return platform === 'win32' ? 'ollama.exe' : 'ollama';
}

/**
 * The platform-standard locations a user-installed Ollama is looked for, after the PATH. These are the
 * defaults the official installers use.
 * @param platform The Node platform.
 * @param env The environment, used to locate the Windows per-user install directory.
 * @returns Returns the absolute paths to probe, most likely first.
 */
export function ollamaSystemLocations(
  platform: string,
  env: Record<string, string | undefined>,
): string[] {
  switch (platform) {
    case 'darwin':
      return [
        '/usr/local/bin/ollama',
        '/opt/homebrew/bin/ollama',
        // The macOS app bundles the CLI inside itself.
        '/Applications/Ollama.app/Contents/Resources/ollama',
      ];
    case 'linux':
      return ['/usr/local/bin/ollama', '/usr/bin/ollama'];
    case 'win32': {
      const localAppData: string | undefined = env['LOCALAPPDATA'];
      const programFiles: string = env['ProgramFiles'] ?? 'C:\\Program Files';
      const locations: string[] = [`${programFiles}\\Ollama\\ollama.exe`];
      if (localAppData !== undefined) {
        locations.unshift(`${localAppData}\\Programs\\Ollama\\ollama.exe`);
      }
      return locations;
    }
    default:
      return [];
  }
}
