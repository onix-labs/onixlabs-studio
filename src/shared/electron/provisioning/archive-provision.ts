/**
 * Describes how to obtain one platform's build of a downloadable component: the archive URL, its
 * pinned SHA-256 (verified before anything is extracted, so tampered code is never run), the archive
 * kind, and the executable or entry point's path within the extracted tree.
 */
export interface ArchiveDownload {
  /**
   * Gets the archive URL to download.
   */
  readonly url: string;

  /**
   * Gets the expected lower-case hex SHA-256 of the archive.
   */
  readonly sha256: string;

  /**
   * Gets the archive kind, deciding how it is extracted.
   */
  readonly archive: 'tar.gz' | 'zip';

  /**
   * Gets the executable or entry point's path relative to the extracted directory (for example
   * `package/langserver.index.js`, or `clangd_22.1.6/bin/clangd`).
   */
  readonly executablePath: string;
}

/**
 * A downloadable component's provisioning recipe: an install-directory key, a cache version, and one
 * download per supported `${platform}-${arch}` (upstream may publish different releases per platform,
 * so each entry carries its own URL and checksum).
 *
 * This is the shape a declarative plugin manifest can carry — pure data, no closures — and is
 * deliberately the *only* thing a plugin needs to describe to be installable. Anything that cannot be
 * expressed here needs first-party code, which is the line a third-party manifest format (#294) has to
 * draw.
 */
export interface ArchiveProvision {
  /**
   * Gets the install-directory key.
   */
  readonly id: string;

  /**
   * Gets the cache version; bumping it provisions into a fresh version-scoped directory.
   */
  readonly version: string;

  /**
   * Gets the per-platform downloads, keyed by `${process.platform}-${process.arch}`.
   */
  readonly downloads: Readonly<Record<string, ArchiveDownload>>;
}

/**
 * Gets the key identifying the current platform in a provision's downloads.
 * @returns Returns the platform key.
 */
export function platformKey(): string {
  return `${process.platform}-${process.arch}`;
}

/**
 * Builds a provision whose single archive serves every supported platform, for a component that ships
 * platform-independent content (an npm tarball of JavaScript, for example).
 * @param id The install-directory key.
 * @param version The cache version.
 * @param download The one download, reused for every platform.
 * @returns Returns the provision.
 */
export function everyPlatform(
  id: string,
  version: string,
  download: ArchiveDownload,
): ArchiveProvision {
  return {
    id,
    version,
    downloads: {
      'darwin-arm64': download,
      'darwin-x64': download,
      'linux-x64': download,
      'linux-arm64': download,
      'win32-x64': download,
    },
  };
}
