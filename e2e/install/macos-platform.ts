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
 * macOS, from the disk image release.yml ships.
 *
 * A user opens the DMG and drags the app into an Applications folder. That is done here with
 * `hdiutil` and `ditto`, into `~/Applications` — a folder the user owns, which macOS treats as an
 * Applications folder like the system one — and the disk image is detached again before Studio starts,
 * so nothing runs from the image.
 */
export class MacosPlatform implements StudioPlatform {
  /**
   * Gets the platform's name.
   */
  public readonly name: string = 'macos';

  /**
   * Mounts the disk image, copies the app out and detaches it.
   * @param installer The DMG.
   * @returns Returns the installation.
   */
  public async install(installer: string): Promise<InstalledStudio> {
    const mount: string = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-dmg-'));
    await run('hdiutil', ['attach', installer, '-nobrowse', '-readonly', '-mountpoint', mount]);
    let installRoot: string;
    try {
      const app: string | undefined = (await fs.readdir(mount)).find((entry: string): boolean =>
        entry.endsWith('.app'),
      );
      if (app === undefined) {
        throw new Error(`The disk image ${installer} holds no .app`);
      }
      const applications: string = path.join(os.homedir(), 'Applications');
      await fs.mkdir(applications, { recursive: true });
      installRoot = path.join(applications, app);
      await fs.rm(installRoot, { recursive: true, force: true });
      // ditto, as the Finder copies: it keeps the bundle's symbolic links, extended attributes and
      // permissions, which a plain recursive copy of a framework bundle does not.
      await run('ditto', [path.join(mount, app), installRoot]);
    } finally {
      await run('hdiutil', ['detach', mount]);
    }
    // The bundle's executable, as the Finder would launch it: named in Info.plist, and the only file
    // in Contents/MacOS.
    const binaries: readonly string[] = await fs.readdir(
      path.join(installRoot, 'Contents', 'MacOS'),
    );
    const executable: string | undefined = binaries[0];
    if (binaries.length !== 1 || executable === undefined) {
      throw new Error(`Expected one executable in the app bundle, found: ${binaries.join(', ')}`);
    }
    return { executable: path.join(installRoot, 'Contents', 'MacOS', executable), installRoot };
  }

  /**
   * Gets no extra arguments: a runner grants Chromium its sandbox.
   * @returns Returns none.
   */
  public launchArguments(): readonly string[] {
    return [];
  }

  /**
   * Gets what launchd hands an application started from the Finder or the Dock: the user, a temporary
   * folder and the system's bare PATH, and no TERM — so Studio captures the login shell's environment
   * (the toolchains the runner's `~/.zprofile` puts on PATH) exactly as it does for a user.
   * @returns Returns the environment.
   */
  public launchEnvironment(): Readonly<Record<string, string>> {
    const environment: Record<string, string> = {
      SHELL: '/bin/zsh',
      PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
    };
    for (const name of ['HOME', 'USER', 'LOGNAME', 'TMPDIR', 'LANG']) {
      const value: string | undefined = process.env[name];
      if (value !== undefined) {
        environment[name] = value;
      }
    }
    return environment;
  }

  /**
   * Gets the user's home, where launchd starts what it launches.
   * @returns Returns the directory.
   */
  public launchDirectory(): string {
    return os.homedir();
  }
}
