import { app } from 'electron';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { createGunzip } from 'node:zlib';
import { logger } from '../logger';
import { ArchiveDownload, ArchiveProvision, platformKey } from '../provisioning/archive-provision';

/**
 * Runs a child process and resolves with its standard output and error, used for the lightweight
 * version probes the provisioner performs.
 */
const execFileAsync: (
  file: string,
  args: readonly string[],
  options?: { env?: NodeJS.ProcessEnv; maxBuffer?: number },
) => Promise<{ stdout: string; stderr: string }> = promisify(execFile);

/**
 * Holds the pinned Eclipse JDT Language Server version. The distribution is pinned (rather than a
 * moving snapshot) so every machine provisions the same, verified server; bumping it re-downloads
 * into a fresh version-scoped directory.
 */
export const JDTLS_VERSION: string = '1.58.0';

/**
 * Holds the URL of the pinned Eclipse JDT Language Server distribution.
 */
const JDTLS_URL: string =
  'https://download.eclipse.org/jdtls/milestones/1.58.0/jdt-language-server-1.58.0-202604151538.tar.gz';

/**
 * Holds the expected SHA-256 of the pinned distribution. The download is verified against this before
 * it is extracted, so a corrupted or tampered archive of executable code is never run.
 */
const JDTLS_SHA256: string = '2a5bbe55ec91b4325392050dc422cead3220a2459b3766be35e1fff45b4a50d9';

/**
 * Holds the lowest Java major version the downloaded language server can run on.
 */
const MINIMUM_JAVA_VERSION: number = 21;

/**
 * Holds the pinned version of the Roslyn C# language server (`Microsoft.CodeAnalysis.LanguageServer`,
 * the same engine the open-source vscode-csharp extension uses). The distribution is pinned so every
 * machine provisions the same server; bumping it downloads into a fresh, version-scoped directory.
 * This build is the newest published to the public feed below — newer vscode-csharp builds depend on
 * private feeds and are not publicly downloadable.
 */
export const ROSLYN_VERSION: string = '5.4.0-2.26179.14';

/**
 * Holds the NuGet flat-container base URL of the public Azure DevOps feed the Roslyn server is
 * published to. A package is fetched from `<base>/<id>/<version>/<id>.<version>.nupkg`, where the id
 * is lower-cased; a `.nupkg` is a plain zip.
 */
const ROSLYN_FEED: string =
  'https://pkgs.dev.azure.com/azure-public/vside/_packaging/vs-impl/nuget/v3/flat2';

/**
 * Holds the pinned version of the Kotlin language server (`fwcd/kotlin-language-server`). The
 * distribution is pinned so every machine provisions the same, verified server; bumping it downloads
 * into a fresh, version-scoped directory.
 */
export const KOTLIN_LS_VERSION: string = '1.3.13';

/**
 * Holds the URL of the pinned Kotlin language server distribution (its GitHub release `server.zip`).
 */
const KOTLIN_LS_URL: string =
  'https://github.com/fwcd/kotlin-language-server/releases/download/1.3.13/server.zip';

/**
 * Holds the expected SHA-256 of the pinned Kotlin server distribution. The download is verified against
 * this before it is extracted, so a corrupted or tampered archive of executable code is never run.
 */
const KOTLIN_LS_SHA256: string = '4fe7d71d087b307c7869036171bd9d8c6a4284cd7c25b89098b0a24eb2d9b6d2';

/**
 * Holds the pinned version of the rust-analyzer language server (a rust-lang release, date-tagged). The
 * distribution is pinned so every machine provisions the same server; bumping it downloads into a
 * fresh, version-scoped directory. Like Roslyn, the download is platform-specific (a per-triple binary),
 * so it is fetched over HTTPS from the official release without a per-platform hash to pin.
 */
export const RUST_ANALYZER_VERSION: string = '2026-07-13';

/**
 * Holds the base URL of the pinned rust-analyzer release. A platform asset is fetched from
 * `<base>/rust-analyzer-<triple>.<ext>`.
 */
const RUST_ANALYZER_BASE: string =
  'https://github.com/rust-lang/rust-analyzer/releases/download/2026-07-13';

/**
 * Holds the pinned version of the Go language server (gopls). gopls publishes no prebuilt binaries, so
 * it is built from source with the detected Go toolchain (`go install`) — pinned so every machine
 * provisions the same server.
 */
export const GOPLS_VERSION: string = 'v0.23.0';

/**
 * Bounds the buffered output of the `go install` and version probes, generous so a verbose build is not
 * truncated.
 */
const GO_BUILD_BUFFER: number = 64 * 1024 * 1024;

/**
 * Holds the lowest .NET SDK major version the Roslyn server needs. Its apphost is framework-dependent
 * (it does not bundle a runtime), and project loading runs design-time builds through the SDK's
 * MSBuild, so an SDK of at least this major must be installed.
 */
const MINIMUM_DOTNET_SDK_VERSION: number = 10;

/**
 * Matches the version reported by `java -version`, capturing the major component (and, for legacy
 * `1.x` strings, the second component that carries the real major).
 */
const JAVA_VERSION_PATTERN: RegExp = /version "(\d+)(?:\.(\d+))?/;

/**
 * Describes an installed Eclipse JDT Language Server: the launcher JAR and the platform configuration
 * directory needed to start it.
 */
export interface JdtlsInstall {
  /**
   * Gets the absolute path of the Equinox launcher JAR.
   */
  readonly launcherJar: string;

  /**
   * Gets the absolute path of the platform-specific configuration directory.
   */
  readonly configDir: string;
}

/**
 * Provisions external (non-npm) language servers and detects the runtimes they need. It downloads and
 * caches the Eclipse JDT Language Server under the user-data directory and locates a suitable Java
 * runtime, degrading to null when a runtime is missing or a download fails so the caller can leave the
 * language unsupported rather than failing hard.
 */
export class LspProvisioner {
  /**
   * Caches the detected Java executable lookup, so detection runs once per session.
   */
  private jdkProbe: Promise<string | null> | null = null;

  /**
   * Caches the in-flight or completed JDT.LS installation, so it is downloaded at most once.
   */
  private jdtlsProvision: Promise<JdtlsInstall | null> | null = null;

  /**
   * Caches the detected .NET executable lookup, so detection runs once per session.
   */
  private dotnetProbe: Promise<string | null> | null = null;

  /**
   * Caches the in-flight or completed Roslyn server download, so it is downloaded at most once.
   */
  private roslynProvision: Promise<string | null> | null = null;

  /**
   * Caches the in-flight or completed Kotlin server download, so it is downloaded at most once.
   */
  private kotlinProvision: Promise<string | null> | null = null;

  /**
   * Caches the in-flight or completed rust-analyzer download, so it is downloaded at most once.
   */
  private rustProvision: Promise<string | null> | null = null;

  /**
   * Caches the detected Go executable lookup, so detection runs once per session.
   */
  private goProbe: Promise<string | null> | null = null;

  /**
   * Caches the in-flight or completed gopls build, so it is built at most once.
   */
  private goplsProvision: Promise<string | null> | null = null;

  /**
   * Caches the detected clangd executable lookup, so detection runs once per session.
   */
  private clangdProbe: Promise<string | null> | null = null;

  /**
   * Caches generic PATH executable lookups by binary and override, so each detection runs once per
   * session. Keyed rather than a single field because it serves every PATH-detected server.
   */
  private readonly executableProbes: Map<string, Promise<string | null>> = new Map<
    string,
    Promise<string | null>
  >();

  /**
   * Caches each archive install, so a component is downloaded at most once per session even if several
   * callers race.
   */
  private readonly archiveInstalls: Map<string, Promise<string | null>> = new Map<
    string,
    Promise<string | null>
  >();

  /**
   * Detects a usable Java executable: the user's override when given, then the one under `JAVA_HOME`,
   * then `java` on the PATH, provided it reports a high enough version. The result is cached for the
   * session (the override is stable per launch).
   * @param override The user's configured Java executable, or null to auto-detect.
   * @returns Returns the Java executable to launch, or null when none is suitable.
   */
  public detectJava(override: string | null): Promise<string | null> {
    this.jdkProbe ??= this.probeJava(override);
    return this.jdkProbe;
  }

  /**
   * Ensures the Eclipse JDT Language Server is installed under the user-data directory, downloading
   * and extracting it on first use and reusing the cached copy thereafter. The work is shared across
   * concurrent callers.
   * @returns Returns the installation, or null when it could not be provisioned.
   */
  public ensureJdtls(): Promise<JdtlsInstall | null> {
    this.jdtlsProvision ??= this.provisionJdtls();
    return this.jdtlsProvision;
  }

  /**
   * Detects a usable .NET executable backed by an SDK of at least {@link MINIMUM_DOTNET_SDK_VERSION}
   * (which the Roslyn C# server's apphost and design-time builds need): the user's override when given,
   * then `DOTNET_ROOT`, then `dotnet` on the PATH, then the platform's default install location. The
   * result is cached for the session.
   * @param override The user's configured .NET executable, or null to auto-detect.
   * @returns Returns the .NET executable to use, or null when none reports a recent-enough SDK.
   */
  public detectDotnet(override: string | null): Promise<string | null> {
    this.dotnetProbe ??= this.probeDotnet(override);
    return this.dotnetProbe;
  }

  /**
   * Ensures the Roslyn C# language server is installed under the user-data directory, downloading and
   * extracting its platform-specific package on first use and reusing the cached copy thereafter. The
   * work is shared across concurrent callers.
   * @returns Returns the absolute path of the server apphost, or null when it could not be provisioned.
   */
  public ensureRoslyn(): Promise<string | null> {
    this.roslynProvision ??= this.provisionRoslyn();
    return this.roslynProvision;
  }

  /**
   * Ensures the Kotlin language server is installed under the user-data directory, downloading and
   * extracting it on first use and reusing the cached copy thereafter. The work is shared across
   * concurrent callers.
   * @returns Returns the absolute path of the launcher script, or null when it could not be provisioned.
   */
  public ensureKotlin(): Promise<string | null> {
    this.kotlinProvision ??= this.provisionKotlin();
    return this.kotlinProvision;
  }

  /**
   * Ensures the rust-analyzer language server is installed under the user-data directory, downloading
   * and extracting its platform-specific binary on first use and reusing the cached copy thereafter.
   * The work is shared across concurrent callers.
   * @returns Returns the absolute path of the server binary, or null when it could not be provisioned.
   */
  public ensureRustAnalyzer(): Promise<string | null> {
    this.rustProvision ??= this.provisionRustAnalyzer();
    return this.rustProvision;
  }

  /**
   * Detects a usable Go executable (needed both to build and to run gopls): the user's override when
   * given, then the one under `GOROOT`, then `go` on the PATH, then the platform's usual install
   * locations. The result is cached for the session.
   * @param override The user's configured Go executable, or null to auto-detect.
   * @returns Returns the Go executable, or null when none is found.
   */
  public detectGo(override: string | null): Promise<string | null> {
    this.goProbe ??= this.probeGo(override);
    return this.goProbe;
  }

  /**
   * Ensures the Go language server (gopls) is built under the user-data directory, running `go install`
   * into a controlled GOBIN on first use and reusing the cached binary thereafter. The work is shared
   * across concurrent callers.
   * @param go The Go executable used to build gopls.
   * @returns Returns the absolute path of the gopls binary, or null when it could not be built.
   */
  public ensureGopls(go: string): Promise<string | null> {
    this.goplsProvision ??= this.provisionGopls(go);
    return this.goplsProvision;
  }

  /**
   * Detects a usable `clangd` executable (for C and C++): the user's override when given, then
   * `clangd` on the PATH, then the platform's usual install locations (Xcode Command Line Tools,
   * Homebrew LLVM, system LLVM). clangd is not downloaded; it ships with LLVM/Xcode. The result is
   * cached for the session.
   * @param override The user's configured clangd executable, or null to auto-detect.
   * @returns Returns the clangd executable to launch, or null when none is found.
   */
  public detectClangd(override: string | null): Promise<string | null> {
    this.clangdProbe ??= this.probeClangd(override);
    return this.clangdProbe;
  }

  /**
   * Detects an executable that is expected to be on the PATH (or at an explicit override), by running
   * it with `--version` and accepting it when it runs. This is the provisioning story for a server that
   * ships no pinned release asset the application can verify — it is offered, and is unavailable until
   * the user installs it — as opposed to the download-and-verify path the bundled servers take. The
   * result is cached per binary for the session.
   * @param binary The executable name to detect.
   * @param override The user's configured executable, tried first when given.
   * @returns Returns the executable to launch, or null when it is not installed.
   */
  public detectExecutable(binary: string, override: string | null = null): Promise<string | null> {
    const key: string = `${binary}::${override ?? ''}`;
    let probe: Promise<string | null> | undefined = this.executableProbes.get(key);
    if (probe === undefined) {
      probe = this.probeExecutable(binary, override);
      this.executableProbes.set(key, probe);
    }
    return probe;
  }

  /**
   * Probes for an executable without consulting the cache.
   * @param binary The executable name to detect.
   * @param override The user's configured executable, tried first when given.
   * @returns Returns the executable, or null when none runs.
   */
  private async probeExecutable(binary: string, override: string | null): Promise<string | null> {
    const candidates: string[] = [];
    if (override !== null && override.length > 0) {
      candidates.push(override);
    }
    candidates.push(process.platform === 'win32' ? `${binary}.exe` : binary);
    for (const candidate of candidates) {
      try {
        await execFileAsync(candidate, ['--version']);
        logger.debug('LspProvisioner', `Detected ${binary} at ${candidate}`);
        return candidate;
      } catch {
        // Not this candidate; fall through to the next.
      }
    }
    logger.debug('LspProvisioner', `Did not find ${binary} on the PATH`);
    return null;
  }

  /**
   * Installs a component from a pinned, checksum-verified archive, or reuses the cached copy. This is
   * the generic install path every downloadable language server now takes: the recipe is plain data, so
   * adding a server is a catalogue entry rather than a method here.
   * @param provision The provisioning recipe.
   * @returns Returns the executable or entry point path, or null when the platform is unsupported or
   * the download or verification fails.
   */
  public ensureArchive(provision: ArchiveProvision): Promise<string | null> {
    const key: string = `${provision.id} ${provision.version} ${platformKey()}`;
    let install: Promise<string | null> | undefined = this.archiveInstalls.get(key);
    if (install === undefined) {
      install = this.installArchive(provision);
      this.archiveInstalls.set(key, install);
    }
    return install;
  }

  /**
   * Gets whether a component's archive is already installed for this platform, **without downloading
   * anything** — the question the Plugin Manager asks, where {@link ensureArchive} would provision on
   * demand and turn merely looking at the plugin list into a download.
   * @param provision The provisioning recipe.
   * @returns Returns true when the executable is already present.
   */
  public isArchiveInstalled(provision: ArchiveProvision): boolean {
    const target: string | null = this.archiveTarget(provision);
    return target !== null && existsSync(target);
  }

  /**
   * Gets the path a component's archive install produces, whether or not it is installed yet, so the
   * server registry can spawn what the Plugin Manager installed.
   * @param provision The provisioning recipe.
   * @returns Returns the executable path, or null when the platform is unsupported.
   */
  public archiveTarget(provision: ArchiveProvision): string | null {
    const download: ArchiveDownload | undefined = provision.downloads[platformKey()];
    if (download === undefined) {
      return null;
    }
    return path.join(
      this.serversRoot(),
      provision.id,
      provision.version,
      platformKey(),
      download.executablePath,
    );
  }

  /**
   * Removes a component's version-scoped install directory, for uninstalling it.
   * @param provision The provisioning recipe.
   * @returns Returns a promise that resolves once the install is gone.
   */
  public async removeArchive(provision: ArchiveProvision): Promise<void> {
    const directory: string = path.join(
      this.serversRoot(),
      provision.id,
      provision.version,
      platformKey(),
    );
    logger.info('LspProvisioner', `Removing provisioned directory ${directory}`);
    await fs.rm(directory, { recursive: true, force: true });
    this.archiveInstalls.delete(`${provision.id} ${provision.version} ${platformKey()}`);
  }

  /**
   * Downloads, verifies, and extracts a component's archive, or reuses a cached copy. Returns null
   * rather than throwing on any failure, so a missing component degrades to "unavailable".
   * @param provision The provisioning recipe.
   * @returns Returns the executable path, or null on failure.
   */
  private async installArchive(provision: ArchiveProvision): Promise<string | null> {
    const download: ArchiveDownload | undefined = provision.downloads[platformKey()];
    const executable: string | null = this.archiveTarget(provision);
    if (download === undefined || executable === null) {
      logger.warn(
        'LspProvisioner',
        `Cannot provision ${provision.id}: unsupported platform ${platformKey()}`,
      );
      return null;
    }
    const installDir: string = path.join(
      this.serversRoot(),
      provision.id,
      provision.version,
      platformKey(),
    );
    try {
      if (existsSync(executable)) {
        return executable;
      }
      logger.info('LspProvisioner', `Downloading ${provision.id} ${provision.version}`);
      await fs.mkdir(installDir, { recursive: true });
      const archive: string = path.join(installDir, `archive.${download.archive}`);
      await this.download(download.url, archive);
      const digest: string = await this.sha256(archive);
      if (digest !== download.sha256) {
        logger.error(
          'LspProvisioner',
          `Checksum mismatch for ${provision.id}: expected ${download.sha256}, got ${digest}`,
        );
        await fs.rm(archive, { force: true });
        return null;
      }
      if (download.archive === 'zip') {
        await this.extractZip(archive, installDir);
      } else {
        await execFileAsync('tar', ['-xzf', archive, '-C', installDir]);
      }
      await fs.rm(archive, { force: true });
      if (!existsSync(executable)) {
        logger.warn('LspProvisioner', `Extracted ${provision.id} but its entry point is missing`);
        return null;
      }
      if (process.platform !== 'win32') {
        // The archive does not carry the executable bit through every extractor.
        await fs.chmod(executable, 0o755);
      }
      logger.info('LspProvisioner', `Installed ${provision.id} at ${executable}`);
      return executable;
    } catch (error: unknown) {
      logger.error('LspProvisioner', `Failed to provision ${provision.id}`, error);
      return null;
    }
  }

  /**
   * Gets whether a version-scoped install directory is already present under the managed servers root,
   * **without downloading anything**. This is how the Plugin Manager reports what is installed: the
   * `ensure*` methods would provision on demand, which would turn merely looking at the plugin list
   * into an unasked-for download.
   * @param segments The path segments of the install directory, relative to the servers root.
   * @returns Returns true when the directory exists.
   */
  public isProvisioned(...segments: readonly string[]): boolean {
    return existsSync(path.join(this.serversRoot(), ...segments));
  }

  /**
   * Removes a version-scoped install directory from the managed servers root, for uninstalling a
   * plugin Studio downloaded. A directory that is not there is not an error — the end state is the
   * same either way.
   * @param segments The path segments of the install directory, relative to the servers root.
   * @returns Returns a promise that resolves once the directory is gone.
   */
  public async removeProvisioned(...segments: readonly string[]): Promise<void> {
    const directory: string = path.join(this.serversRoot(), ...segments);
    logger.info('LspProvisioner', `Removing provisioned directory ${directory}`);
    await fs.rm(directory, { recursive: true, force: true });
  }

  /**
   * Returns a writable, per-workspace data directory for a server, creating it when necessary. Each
   * workspace root gets its own directory so servers that keep project metadata do not collide.
   * @param serverId The server the data directory belongs to.
   * @param rootPath The workspace root the directory is scoped to.
   * @returns Returns the absolute data directory path.
   */
  public async dataDirectory(serverId: string, rootPath: string): Promise<string> {
    // Derive the directory from a hash of the whole root path: truncating the path's own bytes (as a
    // prefix) collides every workspace sharing a leading path segment onto one directory, which makes
    // a server such as jdtls discard and rebuild its cached workspace index on each launch.
    const key: string = createHash('sha256').update(rootPath).digest('hex').slice(0, 32);
    const directory: string = path.join(this.serversRoot(), `${serverId}-data`, key);
    await fs.mkdir(directory, { recursive: true });
    return directory;
  }

  /**
   * Probes for a usable Java executable without consulting the cache.
   * @param override The user's configured Java executable, tried first when given.
   * @returns Returns the Java executable, or null when none is suitable.
   */
  private async probeJava(override: string | null): Promise<string | null> {
    const home: string | undefined = process.env['JAVA_HOME'];
    const candidates: string[] = [];
    if (override !== null && override.length > 0) {
      candidates.push(override);
    }
    if (home !== undefined && home.length > 0) {
      candidates.push(path.join(home, 'bin', process.platform === 'win32' ? 'java.exe' : 'java'));
    }
    candidates.push('java');

    for (const candidate of candidates) {
      const version: number | null = await this.javaVersion(candidate);
      if (version !== null && version >= MINIMUM_JAVA_VERSION) {
        return candidate;
      }
    }
    return null;
  }

  /**
   * Reads a Java executable's major version by running it with `-version`.
   * @param executable The Java executable to probe.
   * @returns Returns the major version, or null when the executable cannot be run or parsed.
   */
  private async javaVersion(executable: string): Promise<number | null> {
    try {
      // `java -version` writes to stderr; the first line looks like `openjdk version "21.0.8"`.
      const { stderr }: { stderr: string } = await execFileAsync(executable, ['-version']);
      const match: RegExpExecArray | null = JAVA_VERSION_PATTERN.exec(stderr);
      if (match === null) {
        return null;
      }
      const major: number = Number(match[1]);
      // Legacy `1.x` version strings encode the real major in the second component (for example 1.8).
      return major === 1 && match[2] !== undefined ? Number(match[2]) : major;
    } catch {
      return null;
    }
  }

  /**
   * Probes for a usable .NET executable without consulting the cache.
   * @param override The user's configured .NET executable, tried first when given.
   * @returns Returns the .NET executable, or null when none reports an SDK.
   */
  private async probeDotnet(override: string | null): Promise<string | null> {
    const root: string | undefined = process.env['DOTNET_ROOT'];
    const exe: string = process.platform === 'win32' ? 'dotnet.exe' : 'dotnet';
    const candidates: string[] = [];
    if (override !== null && override.length > 0) {
      candidates.push(override);
    }
    if (root !== undefined && root.length > 0) {
      candidates.push(path.join(root, exe));
    }
    candidates.push('dotnet');
    candidates.push(
      process.platform === 'win32'
        ? path.join(process.env['ProgramFiles'] ?? 'C:\\Program Files', 'dotnet', exe)
        : path.join('/usr/local/share/dotnet', exe),
    );

    for (const candidate of candidates) {
      if (await this.hasSdk(candidate, MINIMUM_DOTNET_SDK_VERSION)) {
        return candidate;
      }
    }
    return null;
  }

  /**
   * Determines whether a .NET executable reports an installed SDK of at least a given major version.
   * @param executable The .NET executable to probe.
   * @param minMajor The lowest SDK major version that qualifies.
   * @returns Returns true when the executable runs and lists an SDK of at least that major version.
   */
  private async hasSdk(executable: string, minMajor: number): Promise<boolean> {
    try {
      const { stdout }: { stdout: string } = await execFileAsync(executable, ['--list-sdks']);
      // Each line looks like `10.0.100 [/usr/local/share/dotnet/sdk]`; the leading number is the major.
      return stdout.split('\n').some((line: string): boolean => {
        const match: RegExpExecArray | null = /^(\d+)\./.exec(line.trim());
        return match !== null && Number(match[1]) >= minMajor;
      });
    } catch {
      return false;
    }
  }

  /**
   * Probes for a usable clangd executable without consulting the cache.
   * @param override The user's configured clangd executable, tried first when given.
   * @returns Returns the clangd executable, or null when none is found.
   */
  private async probeClangd(override: string | null): Promise<string | null> {
    const candidates: string[] = [];
    if (override !== null && override.length > 0) {
      candidates.push(override);
    }
    candidates.push(process.platform === 'win32' ? 'clangd.exe' : 'clangd');
    if (process.platform === 'darwin') {
      candidates.push(
        '/usr/bin/clangd',
        '/Library/Developer/CommandLineTools/usr/bin/clangd',
        '/opt/homebrew/opt/llvm/bin/clangd',
        '/usr/local/opt/llvm/bin/clangd',
      );
    } else if (process.platform === 'win32') {
      candidates.push(
        path.join(process.env['ProgramFiles'] ?? 'C:\\Program Files', 'LLVM', 'bin', 'clangd.exe'),
      );
    } else {
      candidates.push('/usr/bin/clangd', '/usr/local/bin/clangd');
    }

    for (const candidate of candidates) {
      if (await this.runsClangd(candidate)) {
        return candidate;
      }
    }
    return null;
  }

  /**
   * Determines whether a clangd executable runs and identifies itself.
   * @param executable The clangd executable to probe.
   * @returns Returns true when the executable runs and reports a clangd version.
   */
  private async runsClangd(executable: string): Promise<boolean> {
    try {
      const { stdout }: { stdout: string } = await execFileAsync(executable, ['--version']);
      return stdout.toLowerCase().includes('clangd');
    } catch {
      return false;
    }
  }

  /**
   * Downloads and extracts the Roslyn C# language server's platform-specific package under the
   * user-data directory, or reuses a cached copy.
   * @returns Returns the server apphost path, or null on failure (including an unsupported platform).
   */
  private async provisionRoslyn(): Promise<string | null> {
    const rid: string | null = this.roslynRid();
    if (rid === null) {
      logger.warn('LspProvisioner', 'Cannot provision Roslyn: unsupported platform');
      return null;
    }
    const installDir: string = path.join(this.serversRoot(), 'roslyn', ROSLYN_VERSION, rid);
    const executable: string =
      process.platform === 'win32'
        ? 'Microsoft.CodeAnalysis.LanguageServer.exe'
        : 'Microsoft.CodeAnalysis.LanguageServer';
    const binary: string = path.join(installDir, 'content', 'LanguageServer', rid, executable);
    try {
      if (existsSync(binary)) {
        logger.debug('LspProvisioner', `Reusing cached Roslyn server at ${binary}`);
        return binary;
      }
      logger.info('LspProvisioner', `Downloading Roslyn server ${ROSLYN_VERSION} (${rid})`);
      await fs.mkdir(installDir, { recursive: true });
      const id: string = `microsoft.codeanalysis.languageserver.${rid}`;
      const url: string = `${ROSLYN_FEED}/${id}/${ROSLYN_VERSION}/${id}.${ROSLYN_VERSION}.nupkg`;
      const archive: string = path.join(installDir, 'server.nupkg');
      await this.download(url, archive);
      await this.extractZip(archive, installDir);
      await fs.rm(archive, { force: true });
      if (!existsSync(binary)) {
        logger.warn('LspProvisioner', 'Extracted Roslyn package but the server binary is missing');
        return null;
      }
      // The extracted apphost is the native launcher but the zip does not carry its executable bit.
      if (process.platform !== 'win32') {
        await fs.chmod(binary, 0o755);
      }
      logger.info('LspProvisioner', `Installed Roslyn server at ${binary}`);
      return binary;
    } catch (error: unknown) {
      logger.error('LspProvisioner', 'Failed to provision the Roslyn C# server', error);
      return null;
    }
  }

  /**
   * Resolves the .NET runtime identifier of the Roslyn server package for the current platform and
   * architecture. The `neutral` (runtime-less) package carries no apphost, so an unsupported platform
   * resolves to null rather than to it.
   * @returns Returns the runtime identifier (for example `osx-arm64`), or null when unsupported.
   */
  private roslynRid(): string | null {
    const arm: boolean = process.arch === 'arm64';
    if (process.platform === 'darwin') {
      return arm ? 'osx-arm64' : 'osx-x64';
    }
    if (process.platform === 'win32') {
      return arm ? 'win-arm64' : 'win-x64';
    }
    if (process.platform === 'linux') {
      return arm ? 'linux-arm64' : 'linux-x64';
    }
    return null;
  }

  /**
   * Extracts a zip archive (a `.nupkg` is a plain zip) into a directory, shelling out to the platform's
   * available extractor: `unzip` on macOS and Linux, `tar` (libarchive, which reads zips) on Windows.
   * @param archive The archive to extract.
   * @param destination The directory to extract into.
   * @returns Returns a promise that resolves once extraction completes.
   */
  private async extractZip(archive: string, destination: string): Promise<void> {
    if (process.platform === 'win32') {
      await execFileAsync('tar', ['-xf', archive, '-C', destination]);
    } else {
      await execFileAsync('unzip', ['-q', '-o', archive, '-d', destination]);
    }
  }

  /**
   * Downloads and extracts the language server, or reuses a cached copy.
   * @returns Returns the installation, or null on failure.
   */
  private async provisionJdtls(): Promise<JdtlsInstall | null> {
    const installDir: string = path.join(this.serversRoot(), 'jdtls', JDTLS_VERSION);
    try {
      const existing: JdtlsInstall | null = await this.readInstall(installDir);
      if (existing !== null) {
        logger.debug('LspProvisioner', `Reusing cached JDT.LS at ${installDir}`);
        return existing;
      }
      logger.info('LspProvisioner', `Downloading JDT.LS ${JDTLS_VERSION}`);
      await fs.mkdir(installDir, { recursive: true });
      const archive: string = path.join(installDir, 'jdtls.tar.gz');
      await this.download(JDTLS_URL, archive);
      const digest: string = await this.sha256(archive);
      if (digest !== JDTLS_SHA256) {
        logger.error(
          'LspProvisioner',
          `Checksum mismatch for JDT.LS: expected ${JDTLS_SHA256}, got ${digest}`,
        );
        await fs.rm(archive, { force: true });
        return null;
      }
      await execFileAsync('tar', ['-xzf', archive, '-C', installDir]);
      await fs.rm(archive, { force: true });
      logger.info('LspProvisioner', `Installed JDT.LS into ${installDir}`);
      return await this.readInstall(installDir);
    } catch (error: unknown) {
      logger.error(
        'LspProvisioner',
        'Failed to provision the Java language server (JDT.LS)',
        error,
      );
      return null;
    }
  }

  /**
   * Downloads and extracts the Kotlin language server under the user-data directory, or reuses a cached
   * copy. The distribution unpacks to a `server/` directory whose `bin/kotlin-language-server` launcher
   * (a `.bat` on Windows) starts the server; the launcher speaks LSP over stdio and finds its Java
   * runtime from `JAVA_HOME` (which the registry sets).
   * @returns Returns the launcher path, or null on failure.
   */
  private async provisionKotlin(): Promise<string | null> {
    const installDir: string = path.join(this.serversRoot(), 'kotlin', KOTLIN_LS_VERSION);
    const launcher: string = path.join(
      installDir,
      'server',
      'bin',
      process.platform === 'win32' ? 'kotlin-language-server.bat' : 'kotlin-language-server',
    );
    try {
      if (existsSync(launcher)) {
        logger.debug('LspProvisioner', `Reusing cached Kotlin server at ${launcher}`);
        return launcher;
      }
      logger.info('LspProvisioner', `Downloading Kotlin server ${KOTLIN_LS_VERSION}`);
      await fs.mkdir(installDir, { recursive: true });
      const archive: string = path.join(installDir, 'server.zip');
      await this.download(KOTLIN_LS_URL, archive);
      const digest: string = await this.sha256(archive);
      if (digest !== KOTLIN_LS_SHA256) {
        logger.error(
          'LspProvisioner',
          `Checksum mismatch for Kotlin server: expected ${KOTLIN_LS_SHA256}, got ${digest}`,
        );
        await fs.rm(archive, { force: true });
        return null;
      }
      await this.extractZip(archive, installDir);
      await fs.rm(archive, { force: true });
      if (!existsSync(launcher)) {
        logger.warn('LspProvisioner', 'Extracted Kotlin server but the launcher is missing');
        return null;
      }
      // The extracted launcher script does not carry its executable bit through the zip.
      if (process.platform !== 'win32') {
        await fs.chmod(launcher, 0o755);
      }
      logger.info('LspProvisioner', `Installed Kotlin server at ${launcher}`);
      return launcher;
    } catch (error: unknown) {
      logger.error('LspProvisioner', 'Failed to provision the Kotlin language server', error);
      return null;
    }
  }

  /**
   * Downloads and unpacks the rust-analyzer language server's platform-specific binary under the
   * user-data directory, or reuses a cached copy. The Unix assets are a single gzipped binary; the
   * Windows asset is a zip containing `rust-analyzer.exe`.
   * @returns Returns the server binary path, or null on failure (including an unsupported platform).
   */
  private async provisionRustAnalyzer(): Promise<string | null> {
    const target: { triple: string; zipped: boolean } | null = this.rustAnalyzerTarget();
    if (target === null) {
      logger.warn('LspProvisioner', 'Cannot provision rust-analyzer: unsupported platform');
      return null;
    }
    const installDir: string = path.join(
      this.serversRoot(),
      'rust-analyzer',
      RUST_ANALYZER_VERSION,
      target.triple,
    );
    const binary: string = path.join(
      installDir,
      process.platform === 'win32' ? 'rust-analyzer.exe' : 'rust-analyzer',
    );
    try {
      if (existsSync(binary)) {
        logger.debug('LspProvisioner', `Reusing cached rust-analyzer at ${binary}`);
        return binary;
      }
      logger.info(
        'LspProvisioner',
        `Downloading rust-analyzer ${RUST_ANALYZER_VERSION} (${target.triple})`,
      );
      await fs.mkdir(installDir, { recursive: true });
      const asset: string = `rust-analyzer-${target.triple}.${target.zipped ? 'zip' : 'gz'}`;
      const download: string = path.join(installDir, asset);
      await this.download(`${RUST_ANALYZER_BASE}/${asset}`, download);
      if (target.zipped) {
        await this.extractZip(download, installDir);
      } else {
        await pipeline(createReadStream(download), createGunzip(), createWriteStream(binary));
      }
      await fs.rm(download, { force: true });
      if (!existsSync(binary)) {
        logger.warn('LspProvisioner', 'Unpacked rust-analyzer but the binary is missing');
        return null;
      }
      if (process.platform !== 'win32') {
        await fs.chmod(binary, 0o755);
      }
      logger.info('LspProvisioner', `Installed rust-analyzer at ${binary}`);
      return binary;
    } catch (error: unknown) {
      logger.error('LspProvisioner', 'Failed to provision the rust-analyzer server', error);
      return null;
    }
  }

  /**
   * Resolves the rust-analyzer release target for the current platform and architecture: the Rust
   * target triple naming the asset, and whether that asset is a zip (Windows) or a gzipped binary
   * (Unix).
   * @returns Returns the target, or null when the platform is unsupported.
   */
  private rustAnalyzerTarget(): { triple: string; zipped: boolean } | null {
    const arm: boolean = process.arch === 'arm64';
    if (process.platform === 'darwin') {
      return { triple: arm ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin', zipped: false };
    }
    if (process.platform === 'linux') {
      return {
        triple: arm ? 'aarch64-unknown-linux-gnu' : 'x86_64-unknown-linux-gnu',
        zipped: false,
      };
    }
    if (process.platform === 'win32' && !arm) {
      return { triple: 'x86_64-pc-windows-msvc', zipped: true };
    }
    return null;
  }

  /**
   * Probes for a usable Go executable without consulting the cache.
   * @param override The user's configured Go executable, tried first when given.
   * @returns Returns the Go executable, or null when none is found.
   */
  private async probeGo(override: string | null): Promise<string | null> {
    const root: string | undefined = process.env['GOROOT'];
    const exe: string = process.platform === 'win32' ? 'go.exe' : 'go';
    const candidates: string[] = [];
    if (override !== null && override.length > 0) {
      candidates.push(override);
    }
    if (root !== undefined && root.length > 0) {
      candidates.push(path.join(root, 'bin', exe));
    }
    candidates.push('go');
    if (process.platform === 'win32') {
      candidates.push(
        path.join(process.env['ProgramFiles'] ?? 'C:\\Program Files', 'Go', 'bin', exe),
      );
    } else {
      candidates.push('/usr/local/go/bin/go', '/opt/homebrew/bin/go', '/usr/local/bin/go');
    }
    for (const candidate of candidates) {
      if (await this.runsGo(candidate)) {
        return candidate;
      }
    }
    return null;
  }

  /**
   * Determines whether a Go executable runs and identifies itself.
   * @param executable The Go executable to probe.
   * @returns Returns true when the executable runs and reports a Go version.
   */
  private async runsGo(executable: string): Promise<boolean> {
    try {
      const { stdout }: { stdout: string } = await execFileAsync(executable, ['version']);
      return stdout.toLowerCase().includes('go version');
    } catch {
      return false;
    }
  }

  /**
   * Builds gopls with `go install` into a controlled GOBIN under the user-data directory, or reuses a
   * cached copy. A private GOPATH/GOCACHE (also under the user-data directory) keeps the build from
   * depending on, or polluting, the user's Go environment.
   * @param go The Go executable used to build gopls.
   * @returns Returns the gopls binary path, or null on failure.
   */
  private async provisionGopls(go: string): Promise<string | null> {
    const installDir: string = path.join(this.serversRoot(), 'gopls', GOPLS_VERSION);
    const binary: string = path.join(
      installDir,
      process.platform === 'win32' ? 'gopls.exe' : 'gopls',
    );
    try {
      if (existsSync(binary)) {
        logger.debug('LspProvisioner', `Reusing cached gopls at ${binary}`);
        return binary;
      }
      logger.info('LspProvisioner', `Building gopls ${GOPLS_VERSION} with ${go}`);
      await fs.mkdir(installDir, { recursive: true });
      const goPath: string = path.join(this.serversRoot(), 'go');
      await execFileAsync(go, ['install', `golang.org/x/tools/gopls@${GOPLS_VERSION}`], {
        env: {
          ...process.env,
          GOBIN: installDir,
          GOPATH: goPath,
          GOCACHE: path.join(goPath, 'cache'),
        },
        maxBuffer: GO_BUILD_BUFFER,
      });
      logger.info('LspProvisioner', `Built gopls at ${binary}`);
      return existsSync(binary) ? binary : null;
    } catch (error: unknown) {
      logger.error('LspProvisioner', 'Failed to build the Go language server (gopls)', error);
      return null;
    }
  }

  /**
   * Computes the SHA-256 of a file, streaming it so a large archive is not held in memory.
   * @param file The file to hash.
   * @returns Returns the lower-case hex digest.
   */
  private async sha256(file: string): Promise<string> {
    const hash: ReturnType<typeof createHash> = createHash('sha256');
    await pipeline(createReadStream(file), hash);
    return hash.digest('hex');
  }

  /**
   * Resolves an installation from an extracted directory, when it contains a launcher and a
   * configuration directory for the current platform.
   * @param installDir The directory the server was extracted into.
   * @returns Returns the installation, or null when it is absent or incomplete.
   */
  private async readInstall(installDir: string): Promise<JdtlsInstall | null> {
    const pluginsDir: string = path.join(installDir, 'plugins');
    if (!existsSync(pluginsDir)) {
      return null;
    }
    const entries: string[] = await fs.readdir(pluginsDir);
    const launcher: string | undefined = entries.find(
      (entry: string): boolean =>
        entry.startsWith('org.eclipse.equinox.launcher_') && entry.endsWith('.jar'),
    );
    const configDir: string = path.join(installDir, this.configDirName());
    if (launcher === undefined || !existsSync(configDir)) {
      return null;
    }
    return { launcherJar: path.join(pluginsDir, launcher), configDir };
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
   * Resolves the name of the JDT.LS configuration directory for the current platform and architecture.
   * @returns Returns the configuration directory name (for example `config_mac_arm`).
   */
  private configDirName(): string {
    const arm: string = process.arch === 'arm64' ? '_arm' : '';
    if (process.platform === 'darwin') {
      return `config_mac${arm}`;
    }
    if (process.platform === 'win32') {
      return 'config_win';
    }
    return `config_linux${arm}`;
  }

  /**
   * Gets the root directory under which provisioned servers and their data are stored.
   * @returns Returns the absolute servers-root path.
   */
  private serversRoot(): string {
    return path.join(app.getPath('userData'), 'lsp-servers');
  }
}
