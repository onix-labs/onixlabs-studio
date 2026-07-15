import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, statSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';

/**
 * Runs a child process and resolves with its output, used to shell out to the platform's archive
 * extractor.
 */
const execFileAsync: (
  file: string,
  args: readonly string[],
) => Promise<{ stdout: string; stderr: string }> = promisify(execFile);

/**
 * Describes how to obtain one platform's build of a downloadable debug adapter: the archive URL, its
 * pinned SHA-256 (verified before anything is extracted, so tampered code is never run), the archive
 * kind, and the adapter executable's path within the extracted tree.
 */
export interface DebugAdapterDownload {
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
   * Gets the adapter executable's path relative to the extracted directory (for example
   * `netcoredbg/netcoredbg`).
   */
  readonly executablePath: string;
}

/**
 * A downloadable debug adapter's provisioning recipe: a cache-version key and one download per
 * supported `${platform}-${arch}` (upstream may publish different releases per platform, so each entry
 * carries its own URL and checksum).
 */
export interface DebugAdapterProvision {
  /**
   * Gets the install-directory key (the adapter's binary name).
   */
  readonly id: string;

  /**
   * Gets the cache version; bumping it provisions into a fresh version-scoped directory.
   */
  readonly version: string;

  /**
   * Gets the per-platform downloads, keyed by `${process.platform}-${process.arch}`.
   */
  readonly downloads: Readonly<Record<string, DebugAdapterDownload>>;
}

/**
 * Builds the ordered list of candidate paths to try when locating a debug adapter's executable, so the
 * search order is pure and unit-testable independently of the file system. The order is: an explicit
 * override, then the workspace's local `node_modules/.bin` (so a project-pinned adapter wins over a
 * global one), then each directory on the PATH. On Windows each PATH candidate is expanded to the
 * common executable extensions.
 * @param binary The executable name to locate (without extension).
 * @param rootPath The absolute workspace root, searched for a project-local adapter.
 * @param pathValue The value of the PATH environment variable, or undefined when unset.
 * @param platform The platform, deciding Windows executable-extension expansion.
 * @param override The explicit executable path to try first, or undefined for none.
 * @returns Returns the ordered candidate paths.
 */
export function debugAdapterCandidates(
  binary: string,
  rootPath: string,
  pathValue: string | undefined,
  platform: NodeJS.Platform,
  override?: string,
): string[] {
  const extensions: readonly string[] = platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  const candidates: string[] = [];
  if (override !== undefined && override.length > 0) {
    candidates.push(override);
  }
  const localBin: string = path.join(rootPath, 'node_modules', '.bin');
  for (const directory of [localBin, ...splitPath(pathValue)]) {
    for (const extension of extensions) {
      candidates.push(path.join(directory, `${binary}${extension}`));
    }
  }
  return candidates;
}

/**
 * Splits a PATH environment value into its directory entries, dropping empty entries.
 * @param pathValue The PATH value, or undefined when unset.
 * @returns Returns the directory entries.
 */
function splitPath(pathValue: string | undefined): string[] {
  if (pathValue === undefined || pathValue.length === 0) {
    return [];
  }
  return pathValue.split(path.delimiter).filter((entry: string): boolean => entry.length > 0);
}

/**
 * Locates the debug adapter executables the {@link import('./debug-adapter-registry').DebugAdapterRegistry}
 * resolves, mirroring the role `LspProvisioner` plays for language servers. This phase locates an
 * already-present executable (an explicit override, a project-local install, or one on the PATH) via
 * {@link locate}, and downloads pinned, checksum-verified adapter archives that ship as binaries
 * (netcoredbg) via {@link ensure}. Location lookups and installs are each cached, since the environment
 * is stable per launch.
 */
export class DebugProvisioner {
  /**
   * Holds explicit executable-path overrides keyed by binary name (the user's configured adapter path),
   * tried before any search. Empty until a later phase wires debug settings.
   */
  private readonly overrides: ReadonlyMap<string, string>;

  /**
   * Caches each binary's location lookup, so detection runs once per session per binary.
   */
  private readonly probes: Map<string, Promise<string | null>> = new Map<
    string,
    Promise<string | null>
  >();

  /**
   * Holds the directory downloaded adapters are installed under (a subdirectory of the user-data
   * directory), or null when provisioning is disabled (no root supplied).
   */
  private readonly installRoot: string | null;

  /**
   * Caches each adapter's in-flight or completed installation, so it is downloaded at most once per
   * session even if several launches race.
   */
  private readonly installs: Map<string, Promise<string | null>> = new Map<
    string,
    Promise<string | null>
  >();

  /**
   * Initializes a new instance of the {@link DebugProvisioner} class.
   * @param overrides Explicit executable paths keyed by binary name, or omitted for none.
   * @param installRoot The directory downloaded adapters are installed under, or omitted to disable
   * provisioning (locate-only).
   */
  public constructor(
    overrides: ReadonlyMap<string, string> = new Map<string, string>(),
    installRoot: string | null = null,
  ) {
    this.overrides = overrides;
    this.installRoot = installRoot;
  }

  /**
   * Locates an adapter's executable, returning its absolute path or null when it cannot be found. The
   * result is cached for the session.
   * @param binary The executable name to locate.
   * @param rootPath The absolute workspace root, searched for a project-local adapter.
   * @returns Returns the executable path, or null when none is found.
   */
  public locate(binary: string, rootPath: string): Promise<string | null> {
    const key: string = `${rootPath} ${binary}`;
    let probe: Promise<string | null> | undefined = this.probes.get(key);
    if (probe === undefined) {
      probe = Promise.resolve(this.probe(binary, rootPath));
      this.probes.set(key, probe);
    }
    return probe;
  }

  /**
   * Ensures a downloadable adapter is installed for the current platform, downloading and extracting its
   * pinned, checksum-verified archive on first use and reusing the cached copy thereafter. The work is
   * shared across concurrent callers. Mirrors the LSP provisioner's server installs.
   * @param provision The adapter's provisioning recipe.
   * @returns Returns the executable path, or null when provisioning is disabled, the platform is
   * unsupported, or the download or verification fails.
   */
  public ensure(provision: DebugAdapterProvision): Promise<string | null> {
    const platformKey: string = `${process.platform}-${process.arch}`;
    const download: DebugAdapterDownload | undefined = provision.downloads[platformKey];
    if (this.installRoot === null || download === undefined) {
      return Promise.resolve(null);
    }
    const key: string = `${provision.id} ${provision.version} ${platformKey}`;
    let install: Promise<string | null> | undefined = this.installs.get(key);
    if (install === undefined) {
      install = this.install(this.installRoot, provision, platformKey, download);
      this.installs.set(key, install);
    }
    return install;
  }

  /**
   * Downloads, verifies, and extracts an adapter's archive into a version-scoped install directory, or
   * reuses a cached copy. Returns null (rather than throwing) on any failure so a launch degrades to
   * "adapter unavailable" rather than crashing.
   * @param root The install root.
   * @param provision The provisioning recipe.
   * @param platformKey The current platform key, scoping the install directory.
   * @param download The platform's download.
   * @returns Returns the executable path, or null on failure.
   */
  private async install(
    root: string,
    provision: DebugAdapterProvision,
    platformKey: string,
    download: DebugAdapterDownload,
  ): Promise<string | null> {
    const installDir: string = path.join(root, provision.id, provision.version, platformKey);
    const executable: string = path.join(installDir, download.executablePath);
    try {
      if (existsSync(executable)) {
        return executable;
      }
      await fs.mkdir(installDir, { recursive: true });
      const archive: string = path.join(installDir, `archive.${download.archive}`);
      await this.download(download.url, archive);
      const digest: string = await this.sha256(archive);
      if (digest !== download.sha256) {
        await fs.rm(archive, { force: true });
        return null;
      }
      await this.extract(archive, installDir, download.archive);
      await fs.rm(archive, { force: true });
      if (!existsSync(executable)) {
        return null;
      }
      if (process.platform !== 'win32') {
        // The archive does not carry the executable bit through every extractor.
        await fs.chmod(executable, 0o755);
      }
      return executable;
    } catch {
      // Leave a partial install behind for the next attempt to overwrite; report unavailable.
      return null;
    }
  }

  /**
   * Downloads a URL to a file, streaming the response to disk.
   * @param url The URL to download.
   * @param destination The file to write.
   * @returns Returns a promise that resolves once the download completes.
   */
  private async download(url: string, destination: string): Promise<void> {
    const response: Response = await fetch(url);
    if (!response.ok || response.body === null) {
      throw new Error(`Download failed: ${response.status}`);
    }
    await pipeline(Readable.fromWeb(response.body), createWriteStream(destination));
  }

  /**
   * Computes the streaming SHA-256 of a file.
   * @param file The file to hash.
   * @returns Returns the lower-case hex digest.
   */
  private async sha256(file: string): Promise<string> {
    const hash: ReturnType<typeof createHash> = createHash('sha256');
    await pipeline(createReadStream(file), hash);
    return hash.digest('hex');
  }

  /**
   * Extracts an archive into a directory, shelling out to the platform's extractor: `tar` reads gzip
   * tarballs everywhere and (via libarchive) zips on Windows; `unzip` reads zips on macOS and Linux.
   * @param archive The archive to extract.
   * @param destination The directory to extract into.
   * @param kind The archive kind.
   * @returns Returns a promise that resolves once extraction completes.
   */
  private async extract(
    archive: string,
    destination: string,
    kind: 'tar.gz' | 'zip',
  ): Promise<void> {
    if (kind === 'tar.gz') {
      await execFileAsync('tar', ['-xzf', archive, '-C', destination]);
    } else if (process.platform === 'win32') {
      await execFileAsync('tar', ['-xf', archive, '-C', destination]);
    } else {
      await execFileAsync('unzip', ['-q', '-o', archive, '-d', destination]);
    }
  }

  /**
   * Searches the candidate paths for the first that is an existing file.
   * @param binary The executable name to locate.
   * @param rootPath The absolute workspace root.
   * @returns Returns the first existing candidate, or null when none exists.
   */
  private probe(binary: string, rootPath: string): string | null {
    const candidates: string[] = debugAdapterCandidates(
      binary,
      rootPath,
      process.env['PATH'],
      process.platform,
      this.overrides.get(binary),
    );
    for (const candidate of candidates) {
      try {
        if (existsSync(candidate) && statSync(candidate).isFile()) {
          return candidate;
        }
      } catch {
        // An unreadable candidate is skipped; the next one is tried.
      }
    }
    return null;
  }
}
