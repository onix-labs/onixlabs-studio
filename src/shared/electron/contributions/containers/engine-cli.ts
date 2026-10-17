import { accessSync, constants } from 'node:fs';
import { delimiter, join } from 'node:path';

/**
 * Where an engine's command-line tool commonly lives on macOS, beyond the PATH: an app launched from
 * the Dock does not inherit a shell's PATH, so `/usr/local/bin` and Homebrew's prefix may be missing
 * from it, and Docker Desktop keeps its tools inside its bundle.
 */
const MAC_FALLBACK_DIRECTORIES: readonly string[] = [
  '/usr/local/bin',
  '/opt/homebrew/bin',
  '/Applications/Docker.app/Contents/Resources/bin',
];

/**
 * Finds an engine's command-line tool on this machine (#973), for the operations that are a terminal
 * session — a shell in a container. Studio no longer downloads one; when none is found, those
 * operations are not offered.
 * @param name The tool's command name, such as `docker`.
 * @param environment The environment whose PATH is searched; defaults to this process's.
 * @param platform The platform; defaults to this one.
 * @returns Returns the tool's absolute path, or null when it is not found.
 */
export function findEngineCli(
  name: string,
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string | null {
  const directories: string[] = (environment['PATH'] ?? '')
    .split(delimiter)
    .filter((entry: string): boolean => entry.length > 0);
  if (platform === 'darwin') {
    directories.push(...MAC_FALLBACK_DIRECTORIES);
  }
  const names: readonly string[] =
    platform === 'win32' ? [`${name}.exe`, `${name}.cmd`, name] : [name];
  for (const directory of directories) {
    for (const candidate of names) {
      const path: string = join(directory, candidate);
      try {
        accessSync(path, platform === 'win32' ? constants.F_OK : constants.X_OK);
        return path;
      } catch {
        // Not here; keep looking.
      }
    }
  }
  return null;
}
