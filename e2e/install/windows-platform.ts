import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import type { InstalledStudio } from './installed-studio';
import type { StudioPlatform } from './studio-platform';

/**
 * Runs a program to completion.
 */
const run: typeof execFile.__promisify__ = promisify(execFile);

/**
 * Windows, from the NSIS installer release.yml ships.
 *
 * The installer is per-user and offers a choice of folder (`oneClick: false`,
 * `allowToChangeInstallationDirectory: true` in electron-builder.yml), so it is run silently with `/S`
 * and told the folder a per-user install defaults to with `/D=`. NSIS reads `/D=` raw, to the end of
 * the command line, so the path is one without spaces and is passed last and unquoted.
 */
export class WindowsPlatform implements StudioPlatform {
  /**
   * Gets the platform's name.
   */
  public readonly name: string = 'windows';

  /**
   * Runs the installer silently and finds the executable it installed.
   * @param installer The NSIS installer.
   * @returns Returns the installation.
   */
  public async install(installer: string): Promise<InstalledStudio> {
    const local: string =
      process.env['LOCALAPPDATA'] ?? path.join(os.homedir(), 'AppData', 'Local');
    const installRoot: string = path.join(local, 'Programs', 'onixlabs-studio');
    if (/\s/.test(installRoot)) {
      throw new Error(`NSIS cannot be given a folder with spaces in it: ${installRoot}`);
    }
    // windowsVerbatimArguments: `/D=` must reach NSIS exactly as written, unquoted.
    await run(installer, ['/S', `/D=${installRoot}`], { windowsVerbatimArguments: true });
    const executable: string | undefined = (await fs.readdir(installRoot)).find(
      (entry: string): boolean => entry.endsWith('.exe') && !entry.startsWith('Uninstall'),
    );
    if (executable === undefined) {
      throw new Error(`The installer put no executable in ${installRoot}`);
    }
    return { executable: path.join(installRoot, executable), installRoot };
  }

  /**
   * Gets no extra arguments.
   * @returns Returns none.
   */
  public launchArguments(): readonly string[] {
    return [];
  }

  /**
   * Gets the user's environment, which is what Explorer hands an application it starts: Windows has
   * no login shell for Studio to capture, so the PATH the toolchain installers set is the one it sees.
   * @returns Returns the environment.
   */
  public launchEnvironment(): Readonly<Record<string, string>> {
    const environment: Record<string, string> = {};
    for (const [name, value] of Object.entries(process.env)) {
      // The runner's own markers are not something a desktop session carries.
      if (value !== undefined && !/^(CI|GITHUB_|RUNNER_|STUDIO_|PLAYWRIGHT|TERM$)/i.test(name)) {
        environment[name] = value;
      }
    }
    return environment;
  }

  /**
   * Gets the user's home, where Explorer starts what it launches.
   * @returns Returns the directory.
   */
  public launchDirectory(): string {
    return os.homedir();
  }
}
