import { app } from 'electron';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';

/**
 * Runs a child process and resolves with its standard output and error, used for the lightweight
 * version probes the provisioner performs.
 */
const execFileAsync: (
  file: string,
  args: readonly string[],
) => Promise<{ stdout: string; stderr: string }> = promisify(execFile);

/**
 * Holds the pinned Eclipse JDT Language Server version. The distribution is pinned (rather than a
 * moving snapshot) so every machine provisions the same, verified server; bumping it re-downloads
 * into a fresh version-scoped directory.
 */
const JDTLS_VERSION: string = '1.58.0';

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
const ROSLYN_VERSION: string = '5.4.0-2.26179.14';

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
const KOTLIN_LS_VERSION: string = '1.3.13';

/**
 * Holds the URL of the pinned Kotlin language server distribution (its GitHub release `server.zip`).
 */
const KOTLIN_LS_URL: string =
  'https://github.com/fwcd/kotlin-language-server/releases/download/1.3.13/server.zip';

/**
 * Holds the expected SHA-256 of the pinned Kotlin server distribution. The download is verified against
 * this before it is extracted, so a corrupted or tampered archive of executable code is never run.
 */
const KOTLIN_LS_SHA256: string =
  '4fe7d71d087b307c7869036171bd9d8c6a4284cd7c25b89098b0a24eb2d9b6d2';

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
   * Caches the detected clangd executable lookup, so detection runs once per session.
   */
  private clangdProbe: Promise<string | null> | null = null;

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
        return binary;
      }
      await fs.mkdir(installDir, { recursive: true });
      const id: string = `microsoft.codeanalysis.languageserver.${rid}`;
      const url: string = `${ROSLYN_FEED}/${id}/${ROSLYN_VERSION}/${id}.${ROSLYN_VERSION}.nupkg`;
      const archive: string = path.join(installDir, 'server.nupkg');
      await this.download(url, archive);
      await this.extractZip(archive, installDir);
      await fs.rm(archive, { force: true });
      if (!existsSync(binary)) {
        return null;
      }
      // The extracted apphost is the native launcher but the zip does not carry its executable bit.
      if (process.platform !== 'win32') {
        await fs.chmod(binary, 0o755);
      }
      return binary;
    } catch {
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
        return existing;
      }
      await fs.mkdir(installDir, { recursive: true });
      const archive: string = path.join(installDir, 'jdtls.tar.gz');
      await this.download(JDTLS_URL, archive);
      const digest: string = await this.sha256(archive);
      if (digest !== JDTLS_SHA256) {
        await fs.rm(archive, { force: true });
        return null;
      }
      await execFileAsync('tar', ['-xzf', archive, '-C', installDir]);
      await fs.rm(archive, { force: true });
      return await this.readInstall(installDir);
    } catch {
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
        return launcher;
      }
      await fs.mkdir(installDir, { recursive: true });
      const archive: string = path.join(installDir, 'server.zip');
      await this.download(KOTLIN_LS_URL, archive);
      const digest: string = await this.sha256(archive);
      if (digest !== KOTLIN_LS_SHA256) {
        await fs.rm(archive, { force: true });
        return null;
      }
      await this.extractZip(archive, installDir);
      await fs.rm(archive, { force: true });
      if (!existsSync(launcher)) {
        return null;
      }
      // The extracted launcher script does not carry its executable bit through the zip.
      if (process.platform !== 'win32') {
        await fs.chmod(launcher, 0o755);
      }
      return launcher;
    } catch {
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
