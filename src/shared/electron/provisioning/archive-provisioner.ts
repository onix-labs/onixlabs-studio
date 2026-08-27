import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { logger } from '../logger';
import { ArchiveDownload, ArchiveProvision, platformKey } from './archive-provision';

/**
 * Runs a child process and resolves with its output, used to shell out to the platform's extractor.
 */
const execFileAsync: (
  file: string,
  args: readonly string[],
) => Promise<{ stdout: string; stderr: string }> = promisify(execFile);

/**
 * The name of the file written into an install directory once its contents are complete.
 */
const MARKER: string = '.studio-install-complete';

/**
 * Marks an install directory complete, after everything it should contain is present and verified.
 *
 * Exported because the provisions that predate this class — the ones whose layout a recipe cannot
 * describe, like the JDT launcher JAR found by glob — need the same guarantee: an interrupted download
 * leaves a directory behind, and a directory is not evidence of a working install.
 * @param directory The install directory.
 * @returns Returns a promise that resolves once the marker is written.
 */
export async function markComplete(directory: string): Promise<void> {
  await fs.writeFile(path.join(directory, MARKER), new Date(0).toISOString(), 'utf8');
}

/**
 * Gets whether an install directory was marked complete.
 * @param directory The install directory.
 * @returns Returns true when the install finished.
 */
export function isComplete(directory: string): boolean {
  return existsSync(path.join(directory, MARKER));
}

/**
 * Downloads, verifies, extracts and removes the pinned archives Studio installs — language servers,
 * debug adapters, anything that arrives as a checksummed file from a publisher.
 *
 * One implementation, shared. The LSP and debug sides each grew their own copy of download-verify-
 * extract; they did the same job from the same shape of recipe, and two copies of code that runs
 * downloaded executables is one copy too many.
 */
export class ArchiveProvisioner {
  /**
   * Holds the directory installs are rooted at, or null when provisioning is disabled.
   */
  private readonly root: string | null;

  /**
   * Holds the name this provisioner logs under, so a line is attributable to the side that asked.
   */
  private readonly logName: string;

  /**
   * Caches each install, so a component is downloaded at most once per session even if callers race.
   */
  private readonly installs: Map<string, Promise<string | null>> = new Map<
    string,
    Promise<string | null>
  >();

  /**
   * Initializes a new instance of the {@link ArchiveProvisioner} class.
   * @param root The directory installs are rooted at, or null to disable provisioning.
   * @param logName The name to log under.
   */
  public constructor(root: string | null, logName: string) {
    this.root = root;
    this.logName = logName;
  }

  /**
   * Gets the directory a provision installs into for this platform, or null when unsupported.
   * @param provision The provisioning recipe.
   * @returns Returns the install directory, or null.
   */
  public directoryOf(provision: ArchiveProvision): string | null {
    if (this.root === null || provision.downloads[platformKey()] === undefined) {
      return null;
    }
    return path.join(this.root, provision.id, provision.version, platformKey());
  }

  /**
   * Gets the executable or entry point a provision installs, whether or not it is installed yet.
   * @param provision The provisioning recipe.
   * @returns Returns the path, or null when the platform is unsupported.
   */
  public targetOf(provision: ArchiveProvision): string | null {
    const directory: string | null = this.directoryOf(provision);
    const download: ArchiveDownload | undefined = provision.downloads[platformKey()];
    return directory === null || download === undefined
      ? null
      : path.join(directory, download.executablePath);
  }

  /**
   * Gets whether a provision is installed, **without downloading anything**. Requires both the
   * completion marker and the executable: a download interrupted midway leaves a directory, and
   * sometimes a partial file, neither of which is a working install.
   * @param provision The provisioning recipe.
   * @returns Returns true when it is installed.
   */
  public isInstalled(provision: ArchiveProvision): boolean {
    const directory: string | null = this.directoryOf(provision);
    const target: string | null = this.targetOf(provision);
    return directory !== null && target !== null && isComplete(directory) && existsSync(target);
  }

  /**
   * Installs a provision, or reuses the cached copy.
   * @param provision The provisioning recipe.
   * @returns Returns the executable path, or null when the platform is unsupported or the download or
   * verification fails.
   */
  public ensure(provision: ArchiveProvision): Promise<string | null> {
    const key: string = `${provision.id} ${provision.version} ${platformKey()}`;
    let install: Promise<string | null> | undefined = this.installs.get(key);
    if (install === undefined) {
      install = this.install(provision);
      this.installs.set(key, install);
    }
    return install;
  }

  /**
   * Removes a provision's version-scoped install directory.
   * @param provision The provisioning recipe.
   * @returns Returns a promise that resolves once the install is gone.
   */
  public async remove(provision: ArchiveProvision): Promise<void> {
    const directory: string | null = this.directoryOf(provision);
    if (directory === null) {
      return;
    }
    logger.info(this.logName, `Removing provisioned directory ${directory}`);
    await fs.rm(directory, { recursive: true, force: true });
    // Prune the version and id directories the platform directory sat under, so uninstalling does not
    // leave a skeleton of empty folders behind. `rmdir` refuses a non-empty directory, which is exactly
    // the wanted behaviour when another platform or version is still installed.
    await fs.rmdir(path.dirname(directory)).catch((): void => undefined);
    await fs.rmdir(path.dirname(path.dirname(directory))).catch((): void => undefined);
    this.installs.delete(`${provision.id} ${provision.version} ${platformKey()}`);
  }

  /**
   * Downloads, verifies and extracts an archive. Returns null rather than throwing on any failure, so a
   * missing component degrades to "unavailable" instead of taking the caller down with it.
   * @param provision The provisioning recipe.
   * @returns Returns the executable path, or null on failure.
   */
  private async install(provision: ArchiveProvision): Promise<string | null> {
    const download: ArchiveDownload | undefined = provision.downloads[platformKey()];
    const directory: string | null = this.directoryOf(provision);
    const target: string | null = this.targetOf(provision);
    if (download === undefined || directory === null || target === null) {
      logger.warn(
        this.logName,
        `Cannot provision ${provision.id}: ${this.root === null ? 'provisioning disabled' : `unsupported platform ${platformKey()}`}`,
      );
      return null;
    }
    if (this.isInstalled(provision)) {
      return target;
    }
    try {
      // Start clean: a previous attempt may have left a partial extraction behind.
      await fs.rm(directory, { recursive: true, force: true });
      await fs.mkdir(directory, { recursive: true });
      logger.info(this.logName, `Downloading ${provision.id} ${provision.version}`);
      const archive: string = path.join(directory, `archive.${download.archive}`);
      await this.download(download.url, archive);
      const digest: string = await this.sha256(archive);
      if (digest !== download.sha256) {
        logger.error(
          this.logName,
          `Checksum mismatch for ${provision.id}: expected ${download.sha256}, got ${digest}`,
        );
        await fs.rm(directory, { recursive: true, force: true });
        return null;
      }
      await this.extract(archive, directory, download.archive);
      await fs.rm(archive, { force: true });
      if (!existsSync(target)) {
        logger.warn(this.logName, `Extracted ${provision.id} but its entry point is missing`);
        await fs.rm(directory, { recursive: true, force: true });
        return null;
      }
      if (process.platform !== 'win32') {
        // The archive does not carry the executable bit through every extractor.
        await fs.chmod(target, 0o755);
      }
      await markComplete(directory);
      logger.info(this.logName, `Installed ${provision.id} at ${target}`);
      return target;
    } catch (error: unknown) {
      logger.error(this.logName, `Failed to provision ${provision.id}`, error);
      await fs.rm(directory, { recursive: true, force: true }).catch((): void => undefined);
      return null;
    }
  }

  /**
   * Extracts an archive into a directory using the platform's available extractor.
   * @param archive The archive path.
   * @param destination The directory to extract into.
   * @param kind The archive kind.
   * @returns Returns a promise that resolves once extraction completes.
   */
  private async extract(
    archive: string,
    destination: string,
    kind: ArchiveDownload['archive'],
  ): Promise<void> {
    if (kind === 'tar.gz') {
      await execFileAsync('tar', ['-xzf', archive, '-C', destination]);
      return;
    }
    // `tar` reads zips through libarchive on Windows and modern macOS; `unzip` is the fallback.
    if (process.platform === 'win32') {
      await execFileAsync('tar', ['-xf', archive, '-C', destination]);
      return;
    }
    await execFileAsync('unzip', ['-q', '-o', archive, '-d', destination]);
  }

  /**
   * Downloads a URL to a file.
   * @param url The URL to download.
   * @param destination The file to write.
   * @returns Returns a promise that resolves once the download completes.
   */
  private async download(url: string, destination: string): Promise<void> {
    const response: Response = await fetch(url);
    if (!response.ok || response.body === null) {
      throw new Error(`Download failed: ${response.status}`);
    }
    // The two compilations disagree about this type: under the main process's Node libs the cast is
    // redundant, while under the renderer's DOM libs `ReadableStream` is the DOM one and the call will
    // not typecheck without it. The cast keeps this module importable from a spec, which is what makes
    // the code that runs downloaded executables testable at all.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    const body: Parameters<typeof Readable.fromWeb>[0] = response.body as Parameters<
      typeof Readable.fromWeb
    >[0];
    await pipeline(Readable.fromWeb(body), createWriteStream(destination));
  }

  /**
   * Computes a file's SHA-256.
   * @param file The file to hash.
   * @returns Returns the lower-case hex digest.
   */
  private async sha256(file: string): Promise<string> {
    const hash: ReturnType<typeof createHash> = createHash('sha256');
    await pipeline(createReadStream(file), hash);
    return hash.digest('hex');
  }
}
