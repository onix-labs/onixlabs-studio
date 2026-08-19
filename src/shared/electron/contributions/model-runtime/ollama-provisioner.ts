import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, Dirent, existsSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import { promisify } from 'node:util';
import { RuntimeInstallation, RuntimeInstallProgress } from '@shared/api/model-runtime-types';
import { logger } from '../../logger';
import {
  OllamaAsset,
  ollamaAsset,
  ollamaAssetUrl,
  ollamaExecutableName,
  ollamaSystemLocations,
  OLLAMA_VERSION,
} from './ollama-assets';

/**
 * Runs a command and resolves with its stdout.
 */
const execFileAsync: (
  file: string,
  args: readonly string[],
  options: { timeout: number },
) => Promise<{ stdout: string }> = promisify(execFile);

/**
 * How long, in milliseconds, a `--version` probe is given before it is treated as unusable.
 */
const VERSION_PROBE_TIMEOUT_MS: number = 5_000;

/**
 * How deep the extracted archive is searched for the runtime executable. The layout differs between
 * platforms (and between releases), so the binary is found rather than assumed — but bounded, so a
 * pathological archive cannot walk forever.
 */
const EXECUTABLE_SEARCH_DEPTH: number = 4;

/**
 * Receives progress through a managed install.
 */
export type InstallProgressListener = (progress: RuntimeInstallProgress) => void;

/**
 * Finds the Ollama binary, and installs a Studio-managed copy when the user has none.
 *
 * Detection prefers a **system** install — one the user put there themselves, on the PATH or in a
 * platform-standard location — over the managed copy, so a user who already runs Ollama is never made
 * to download a second one. Only when neither exists does the manager offer
 * {@link OllamaProvisioner.install}.
 *
 * Provisioning mirrors {@link import('../../lsp/lsp-provisioner').LspProvisioner}: a pinned version,
 * a hard-coded SHA-256 verified before anything is extracted, a version-scoped install directory, and
 * in-flight caching so concurrent callers share one download.
 */
export class OllamaProvisioner {
  /**
   * The root directory managed installs live under.
   */
  private readonly root: string;

  /**
   * The platform to resolve assets and search locations for.
   */
  private readonly platform: string;

  /**
   * The architecture to resolve assets for.
   */
  private readonly arch: string;

  /**
   * The environment probed for the PATH and platform install locations.
   */
  private readonly env: Record<string, string | undefined>;

  /**
   * The absolute paths probed after the PATH. Injectable because they are absolute by nature, so a
   * test cannot otherwise stop detection finding a real Ollama installed on the machine running it.
   */
  private readonly locations: readonly string[];

  /**
   * The in-flight or completed managed install, so it happens at most once per session.
   */
  private provision: Promise<RuntimeInstallation> | null = null;

  /**
   * Initializes a new instance of the {@link OllamaProvisioner} class.
   * @param root The directory managed installs live under (under `userData` in production).
   * @param platform The Node platform; defaults to the running one.
   * @param arch The Node architecture; defaults to the running one.
   * @param env The environment; defaults to the running process's.
   * @param locations The absolute paths probed after the PATH; defaults to the platform's standard
   * install locations.
   */
  public constructor(
    root: string,
    platform: string = process.platform,
    arch: string = process.arch,
    env: Record<string, string | undefined> = process.env,
    locations: readonly string[] = ollamaSystemLocations(platform, env),
  ) {
    this.root = root;
    this.platform = platform;
    this.arch = arch;
    this.env = env;
    this.locations = locations;
  }

  /**
   * Finds the runtime binary: a system install first, then a managed one, otherwise absent.
   * @returns Returns the installation that was found.
   */
  public async detect(): Promise<RuntimeInstallation> {
    const system: string | null = await this.findSystemExecutable();
    if (system !== null) {
      return { kind: 'system', executable: system, version: await this.probeVersion(system) };
    }
    const managed: string = this.managedExecutable();
    if (existsSync(managed)) {
      return { kind: 'managed', executable: managed, version: await this.probeVersion(managed) };
    }
    return { kind: 'absent', executable: '', version: '' };
  }

  /**
   * Downloads, verifies and extracts the pinned runtime into the managed install directory, or reuses
   * a copy that is already there. Concurrent callers share one install.
   * @param onProgress Receives download and extraction progress.
   * @returns Returns the resulting installation, which is `absent` when the install failed.
   */
  public install(
    onProgress: InstallProgressListener = (): void => undefined,
  ): Promise<RuntimeInstallation> {
    this.provision ??= this.runInstall(onProgress);
    return this.provision;
  }

  /**
   * The path the managed executable occupies once installed.
   * @returns Returns the absolute executable path.
   */
  public managedExecutable(): string {
    return path.join(this.installDir(), ollamaExecutableName(this.platform));
  }

  /**
   * The version-scoped directory a managed install lives in.
   * @returns Returns the absolute install directory.
   */
  private installDir(): string {
    return path.join(this.root, OLLAMA_VERSION, `${this.platform}-${this.arch}`);
  }

  /**
   * Performs the managed install.
   * @param onProgress Receives progress.
   * @returns Returns the resulting installation.
   */
  private async runInstall(onProgress: InstallProgressListener): Promise<RuntimeInstallation> {
    const asset: OllamaAsset | null = ollamaAsset(this.platform, this.arch);
    if (asset === null) {
      const error: string = `Studio cannot provision Ollama for ${this.platform}-${this.arch}`;
      logger.warn('OllamaProvisioner', error);
      onProgress({ stage: 'failed', received: 0, total: 0, error });
      return { kind: 'absent', executable: '', version: '' };
    }

    const installDir: string = this.installDir();
    const executable: string = this.managedExecutable();
    if (existsSync(executable)) {
      logger.debug('OllamaProvisioner', `Reusing managed Ollama at ${executable}`);
      onProgress({ stage: 'done', received: 0, total: 0 });
      return { kind: 'managed', executable, version: await this.probeVersion(executable) };
    }

    const archive: string = path.join(installDir, asset.name);
    try {
      await fs.mkdir(installDir, { recursive: true });
      logger.info('OllamaProvisioner', `Downloading Ollama ${OLLAMA_VERSION} (${asset.name})`);
      await this.download(ollamaAssetUrl(asset), archive, onProgress);

      onProgress({ stage: 'verifying', received: 0, total: 0 });
      const digest: string = await this.sha256(archive);
      if (digest !== asset.sha256) {
        throw new Error(`checksum mismatch: expected ${asset.sha256}, got ${digest}`);
      }

      onProgress({ stage: 'extracting', received: 0, total: 0 });
      await this.extract(archive, asset, installDir);
      await fs.rm(archive, { force: true });

      const found: string | null = await this.findExtractedExecutable(installDir);
      if (found === null) {
        throw new Error('the extracted archive does not contain an ollama executable');
      }
      if (found !== executable) {
        await fs.rename(found, executable).catch(async (): Promise<void> => {
          await fs.copyFile(found, executable);
        });
      }
      if (this.platform !== 'win32') {
        await fs.chmod(executable, 0o755);
      }

      logger.info('OllamaProvisioner', `Installed managed Ollama at ${executable}`);
      onProgress({ stage: 'done', received: 0, total: 0 });
      return { kind: 'managed', executable, version: await this.probeVersion(executable) };
    } catch (error: unknown) {
      logger.error('OllamaProvisioner', 'Failed to provision Ollama', error);
      await fs.rm(archive, { force: true }).catch((): void => undefined);
      // A failed install must not be cached, or the user could never retry it.
      this.provision = null;
      onProgress({
        stage: 'failed',
        received: 0,
        total: 0,
        error: error instanceof Error ? error.message : String(error),
      });
      return { kind: 'absent', executable: '', version: '' };
    }
  }

  /**
   * Streams a download to disk, reporting progress as it goes.
   * @param url The asset URL.
   * @param destination The file to write.
   * @param onProgress Receives download progress.
   * @returns Returns a promise that resolves once the download completes.
   */
  private async download(
    url: string,
    destination: string,
    onProgress: InstallProgressListener,
  ): Promise<void> {
    const response: Response = await fetch(url);
    if (!response.ok || response.body === null) {
      throw new Error(`download failed: ${response.status}`);
    }
    const total: number = Number(response.headers.get('content-length') ?? 0);
    const body: ReadableStream<Uint8Array> = response.body;
    let received: number = 0;

    // Read the web stream explicitly rather than through `Readable.fromWeb`, whose typing differs
    // between the Electron and Angular compilations of this file. `pipeline` still applies
    // backpressure, so a slow disk cannot let the download outrun it.
    async function* chunks(): AsyncGenerator<Uint8Array> {
      const reader: ReadableStreamDefaultReader<Uint8Array> = body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) {
            return;
          }
          received += value.byteLength;
          onProgress({ stage: 'downloading', received, total });
          yield value;
        }
      } finally {
        reader.releaseLock();
      }
    }

    await pipeline(Readable.from(chunks()), createWriteStream(destination));
  }

  /**
   * Computes a file's SHA-256, streaming it so a multi-gigabyte archive is never held in memory.
   * @param file The file to hash.
   * @returns Returns the lower-case hex digest.
   */
  private async sha256(file: string): Promise<string> {
    const hash: ReturnType<typeof createHash> = createHash('sha256');
    await pipeline(createReadStream(file), hash);
    return hash.digest('hex');
  }

  /**
   * Extracts the downloaded archive, shelling out to the platform's available extractor.
   * @param archive The archive to extract.
   * @param asset The asset, naming how it is packed.
   * @param destination The directory to extract into.
   * @returns Returns a promise that resolves once extraction completes.
   */
  private async extract(archive: string, asset: OllamaAsset, destination: string): Promise<void> {
    switch (asset.archive) {
      case 'tgz':
        await execFileAsync('tar', ['-xzf', archive, '-C', destination], { timeout: 0 });
        return;
      case 'tar.zst':
        // GNU tar and libarchive both need zstd support built in; when it is missing the install
        // fails cleanly and the user is told to install Ollama themselves.
        await execFileAsync('tar', ['--zstd', '-xf', archive, '-C', destination], { timeout: 0 });
        return;
      case 'zip':
        if (this.platform === 'win32') {
          await execFileAsync('tar', ['-xf', archive, '-C', destination], { timeout: 0 });
        } else {
          await execFileAsync('unzip', ['-q', '-o', archive, '-d', destination], { timeout: 0 });
        }
        return;
    }
  }

  /**
   * Finds the runtime executable somewhere in the extracted tree, since the archive layout differs by
   * platform and release.
   * @param root The extracted directory.
   * @param depth How much further to descend.
   * @returns Returns the executable path, or null when it is not there.
   */
  private async findExtractedExecutable(
    root: string,
    depth: number = EXECUTABLE_SEARCH_DEPTH,
  ): Promise<string | null> {
    const wanted: string = ollamaExecutableName(this.platform);
    let entries: Dirent[];
    try {
      entries = await fs.readdir(root, { withFileTypes: true });
    } catch {
      return null;
    }

    const directories: string[] = [];
    for (const entry of entries) {
      const full: string = path.join(root, entry.name);
      if (entry.isFile() && entry.name === wanted) {
        return full;
      }
      if (entry.isDirectory()) {
        directories.push(full);
      }
    }
    if (depth <= 0) {
      return null;
    }
    for (const directory of directories) {
      const found: string | null = await this.findExtractedExecutable(directory, depth - 1);
      if (found !== null) {
        return found;
      }
    }
    return null;
  }

  /**
   * Finds a user-installed binary: the PATH first (respecting an explicit `OLLAMA_EXECUTABLE`
   * override), then the platform's standard install locations.
   * @returns Returns the executable path, or null when there is no system install.
   */
  private async findSystemExecutable(): Promise<string | null> {
    const override: string | undefined = this.env['OLLAMA_EXECUTABLE'];
    if (override !== undefined && override.length > 0 && existsSync(override)) {
      return override;
    }

    const onPath: string | null = await this.whichOnPath();
    if (onPath !== null) {
      return onPath;
    }

    for (const location of this.locations) {
      if (existsSync(location)) {
        return location;
      }
    }
    return null;
  }

  /**
   * Resolves the runtime executable on the PATH by walking `PATH` directly rather than shelling out to
   * `which`/`where`, so detection does not depend on a shell being present.
   * @returns Returns the executable path, or null when it is not on the PATH.
   */
  private whichOnPath(): Promise<string | null> {
    const raw: string | undefined = this.env['PATH'] ?? this.env['Path'];
    if (raw === undefined || raw.length === 0) {
      return Promise.resolve(null);
    }
    const separator: string = this.platform === 'win32' ? ';' : ':';
    const wanted: string = ollamaExecutableName(this.platform);
    for (const directory of raw.split(separator)) {
      if (directory.length === 0) {
        continue;
      }
      const candidate: string = path.join(directory, wanted);
      if (existsSync(candidate)) {
        return Promise.resolve(candidate);
      }
    }
    return Promise.resolve(null);
  }

  /**
   * Asks a binary for its version.
   * @param executable The executable to probe.
   * @returns Returns the reported version, or an empty string when it could not be determined.
   */
  private async probeVersion(executable: string): Promise<string> {
    try {
      const { stdout } = await execFileAsync(executable, ['--version'], {
        timeout: VERSION_PROBE_TIMEOUT_MS,
      });
      return parseVersion(stdout);
    } catch (error: unknown) {
      // A binary that will not report its version is still usable, so this is not fatal — but it is
      // worth a line, because the manager will then show the runtime with no version against it.
      logger.debug('OllamaProvisioner', `Could not read the version of ${executable}`, error);
      return '';
    }
  }
}

/**
 * Pulls the version out of `ollama --version` output, which reads `ollama version is 0.32.14`.
 * Exported for unit testing.
 * @param output The command's stdout.
 * @returns Returns the version, or an empty string when the output carries none.
 */
export function parseVersion(output: string): string {
  return /(\d+\.\d+\.\d+(?:-[\w.]+)?)/.exec(output)?.[1] ?? '';
}
