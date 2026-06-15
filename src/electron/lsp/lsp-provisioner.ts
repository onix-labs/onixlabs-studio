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
 * Holds the pinned version of the C# language server (`csharp-ls`), installed as a .NET tool. Pinning
 * keeps every machine on the same, version-scoped install; bumping it installs into a fresh directory.
 */
const CSHARP_LS_VERSION: string = '0.25.0';

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
   * Caches the in-flight or completed `csharp-ls` installation, so it is installed at most once.
   */
  private csharpLsProvision: Promise<string | null> | null = null;

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
   * Detects a usable .NET executable (an SDK, which the C# server needs both to install and to run):
   * the user's override when given, then `DOTNET_ROOT`, then `dotnet` on the PATH, then the platform's
   * default install location. The result is cached for the session.
   * @param override The user's configured .NET executable, or null to auto-detect.
   * @returns Returns the .NET executable to use, or null when none reports an SDK.
   */
  public detectDotnet(override: string | null): Promise<string | null> {
    this.dotnetProbe ??= this.probeDotnet(override);
    return this.dotnetProbe;
  }

  /**
   * Ensures the C# language server (`csharp-ls`) is installed under the user-data directory, installing
   * it as a .NET tool on first use and reusing the cached copy thereafter. The work is shared across
   * concurrent callers.
   * @param dotnet The detected .NET executable used to install and host the tool.
   * @returns Returns the absolute path of the server executable, or null when it could not be installed.
   */
  public ensureCsharpLs(dotnet: string): Promise<string | null> {
    this.csharpLsProvision ??= this.provisionCsharpLs(dotnet);
    return this.csharpLsProvision;
  }

  /**
   * Returns a writable, per-workspace data directory for a server, creating it when necessary. Each
   * workspace root gets its own directory so servers that keep project metadata do not collide.
   * @param serverId The server the data directory belongs to.
   * @param rootPath The workspace root the directory is scoped to.
   * @returns Returns the absolute data directory path.
   */
  public async dataDirectory(serverId: string, rootPath: string): Promise<string> {
    const key: string = Buffer.from(rootPath).toString('hex').slice(0, 32);
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
      if (await this.reportsSdk(candidate)) {
        return candidate;
      }
    }
    return null;
  }

  /**
   * Determines whether a .NET executable reports an installed SDK (which `dotnet tool install` needs).
   * @param executable The .NET executable to probe.
   * @returns Returns true when the executable runs and lists at least one SDK.
   */
  private async reportsSdk(executable: string): Promise<boolean> {
    try {
      const { stdout }: { stdout: string } = await execFileAsync(executable, ['--list-sdks']);
      return stdout.trim().length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Installs the C# language server as a .NET tool under the user-data directory, or reuses a cached
   * copy.
   * @param dotnet The detected .NET executable.
   * @returns Returns the server executable path, or null on failure.
   */
  private async provisionCsharpLs(dotnet: string): Promise<string | null> {
    const installDir: string = path.join(this.serversRoot(), 'csharp-ls', CSHARP_LS_VERSION);
    const binary: string = path.join(
      installDir,
      process.platform === 'win32' ? 'csharp-ls.exe' : 'csharp-ls',
    );
    try {
      if (existsSync(binary)) {
        return binary;
      }
      await fs.mkdir(installDir, { recursive: true });
      await execFileAsync(dotnet, [
        'tool',
        'install',
        '--tool-path',
        installDir,
        'csharp-ls',
        '--version',
        CSHARP_LS_VERSION,
      ]);
      return existsSync(binary) ? binary : null;
    } catch {
      return null;
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
