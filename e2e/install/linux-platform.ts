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
 * Linux, from the AppImage release.yml ships.
 *
 * An AppImage normally mounts itself through FUSE, which a container cannot offer. A user without
 * FUSE — on a minimal or locked-down system, or in a container — runs `--appimage-extract` and starts
 * the extracted `AppRun` instead, which is what this does: into the user's own `~/.local`, as a user
 * with no root would, and linked onto `~/.local/bin` the way a launcher would find it.
 */
export class LinuxPlatform implements StudioPlatform {
  /**
   * Gets the platform's name.
   */
  public readonly name: string = 'linux';

  /**
   * Extracts the AppImage and links its launcher.
   * @param installer The AppImage.
   * @returns Returns the installation.
   */
  public async install(installer: string): Promise<InstalledStudio> {
    const home: string = os.homedir();
    const installRoot: string = path.join(home, '.local', 'share', 'onixlabs-studio');
    const staging: string = path.join(home, '.local', 'share', 'onixlabs-studio-staging');
    await fs.rm(staging, { recursive: true, force: true });
    await fs.mkdir(staging, { recursive: true });
    // The AppImage is copied first, as a user downloads it: it must be executable, and the mount it
    // came from is read-only.
    const appImage: string = path.join(staging, path.basename(installer));
    await fs.copyFile(installer, appImage);
    await fs.chmod(appImage, 0o755);
    await run(appImage, ['--appimage-extract'], { cwd: staging });
    await fs.rm(installRoot, { recursive: true, force: true });
    await fs.rename(path.join(staging, 'squashfs-root'), installRoot);
    await fs.rm(staging, { recursive: true, force: true });

    const bin: string = path.join(home, '.local', 'bin');
    await fs.mkdir(bin, { recursive: true });
    const executable: string = path.join(bin, 'onixlabs-studio');
    await fs.rm(executable, { force: true });
    await fs.symlink(path.join(installRoot, 'AppRun'), executable);
    return { executable, installRoot };
  }

  /**
   * Gets the arguments a container needs: Chromium's sandbox needs user namespaces a container does
   * not grant, as on the CI runners the end-to-end suite uses.
   * @returns Returns the arguments.
   */
  public launchArguments(): readonly string[] {
    return ['--no-sandbox'];
  }

  /**
   * Gets the user's home, where a desktop session starts what it launches.
   *
   * ⚠️ Not the runner's directory. The gate runs from the mounted repository, whose `.git` names a
   * worktree that does not exist in the container, and the Git plugin runs its global requests in
   * Studio's working directory: there `git config --global` refuses to run, so Save identity failed
   * for a reason no user launching from their desktop would meet.
   * @returns Returns the directory.
   */
  public launchDirectory(): string {
    return os.homedir();
  }

  /**
   * Gets what a desktop session passes an application: the user, the display and the system PATH,
   * and no TERM — a launcher is not a terminal, so Studio captures the login shell's environment as
   * it does when a user starts it from their desktop.
   * @returns Returns the environment.
   */
  public launchEnvironment(): Readonly<Record<string, string>> {
    const passed: readonly string[] = [
      'HOME',
      'USER',
      'LOGNAME',
      'DISPLAY',
      'XAUTHORITY',
      'LANG',
      'XDG_RUNTIME_DIR',
    ];
    const environment: Record<string, string> = {
      SHELL: '/bin/bash',
      PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
    };
    for (const name of passed) {
      const value: string | undefined = process.env[name];
      if (value !== undefined) {
        environment[name] = value;
      }
    }
    return environment;
  }
}
