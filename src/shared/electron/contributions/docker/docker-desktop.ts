import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * How to launch Docker Desktop on a given platform: the executable, its arguments, and whether the
 * launch succeeds by exiting cleanly (a short-lived launcher like `open`/`systemctl`) or by simply
 * spawning without error (a long-lived application process detached from the app).
 */
export interface DesktopLaunchCommand {
  /**
   * The executable to run.
   */
  readonly file: string;

  /**
   * The arguments to pass.
   */
  readonly args: readonly string[];

  /**
   * Whether success is judged by a clean exit (true) rather than by spawning without error (false).
   */
  readonly waitForExit: boolean;
}

/**
 * Resolves how to launch Docker Desktop for a platform, or null when there is no supported way. macOS
 * uses `open -a Docker`; Linux uses the Docker Desktop user service; Windows launches the Docker
 * Desktop executable from its default install location.
 * @param platform The platform to resolve for.
 * @param env The environment, used to locate the Windows install directory.
 * @returns Returns the launch command, or null when unsupported.
 */
export function dockerDesktopLaunchCommand(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): DesktopLaunchCommand | null {
  switch (platform) {
    case 'darwin':
      return { file: 'open', args: ['-a', 'Docker'], waitForExit: true };
    case 'linux':
      return { file: 'systemctl', args: ['--user', 'start', 'docker-desktop'], waitForExit: true };
    case 'win32': {
      const programFiles: string = env['ProgramFiles'] ?? 'C:\\Program Files';
      return {
        file: join(programFiles, 'Docker', 'Docker', 'Docker Desktop.exe'),
        args: [],
        waitForExit: false,
      };
    }
    default:
      return null;
  }
}

/**
 * Attempts to launch Docker Desktop through the operating system. Best-effort: it never throws, and
 * resolves false when the platform is unsupported, the executable is missing, or the launch errors.
 * The daemon then takes a while to come up — the caller polls the status to detect readiness.
 * @param platform The platform to launch for; defaults to the current one.
 * @param env The environment; defaults to the current process environment.
 * @returns Returns true when the launch was issued.
 */
export function launchDockerDesktop(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  const command: DesktopLaunchCommand | null = dockerDesktopLaunchCommand(platform, env);
  if (command === null) {
    return Promise.resolve(false);
  }
  // A detached launch names an explicit executable path (Windows); bail early when it is absent so a
  // missing install resolves false rather than surfacing a spawn error.
  if (!command.waitForExit && !existsSync(command.file)) {
    return Promise.resolve(false);
  }
  return new Promise<boolean>((resolve: (launched: boolean) => void): void => {
    let settled: boolean = false;
    const settle: (launched: boolean) => void = (launched: boolean): void => {
      if (!settled) {
        settled = true;
        resolve(launched);
      }
    };
    try {
      const child: ReturnType<typeof spawn> = spawn(command.file, [...command.args], {
        detached: !command.waitForExit,
        stdio: 'ignore',
      });
      child.once('error', (): void => settle(false));
      if (command.waitForExit) {
        child.once('exit', (code: number | null): void => settle(code === 0));
      } else {
        child.unref();
        // Detached, long-lived process: no clean exit to await — success is spawning without an error.
        setTimeout((): void => settle(true), 200);
      }
    } catch {
      settle(false);
    }
  });
}
