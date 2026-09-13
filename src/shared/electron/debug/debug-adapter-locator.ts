import { existsSync, statSync } from 'node:fs';
import * as path from 'node:path';

/**
 * Builds the ordered list of candidate paths to try when locating a debug adapter's executable, so the
 * search order is pure and unit-testable independently of the file system. The order is: an explicit
 * override, then the workspace's local `node_modules/.bin` (so a project-pinned adapter wins over a
 * global one), then each directory on the PATH. On Windows each PATH candidate is expanded to the
 * common executable extensions.
 * @param binary The executable name to locate (without extension).
 * @param rootPath The absolute workspace root, searched for a project-local adapter.
 * @param pathValue The value of the PATH environment variable, or undefined when unset.
 * @param platform The platform, deciding Windows executable-extension expansion.
 * @param override The explicit executable path to try first, or undefined for none.
 * @returns Returns the ordered candidate paths.
 */
export function debugAdapterCandidates(
  binary: string,
  rootPath: string,
  pathValue: string | undefined,
  platform: NodeJS.Platform,
  override?: string,
): string[] {
  const extensions: readonly string[] = platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  const candidates: string[] = [];
  if (override !== undefined && override.length > 0) {
    candidates.push(override);
  }
  const localBin: string = path.join(rootPath, 'node_modules', '.bin');
  for (const directory of [localBin, ...splitPath(pathValue)]) {
    for (const extension of extensions) {
      candidates.push(path.join(directory, `${binary}${extension}`));
    }
  }
  return candidates;
}

/**
 * Splits a PATH environment value into its directory entries, dropping empty entries.
 * @param pathValue The PATH value, or undefined when unset.
 * @returns Returns the directory entries.
 */
function splitPath(pathValue: string | undefined): string[] {
  if (pathValue === undefined || pathValue.length === 0) {
    return [];
  }
  return pathValue.split(path.delimiter).filter((entry: string): boolean => entry.length > 0);
}

/**
 * Locates the debug adapter executables the {@link import('./debug-adapter-registry').DebugAdapterRegistry}
 * resolves: an explicit override, a project-local install, or one on the PATH. Lookups are cached, since
 * the environment is stable per launch.
 *
 * It deliberately obtains nothing. Adapters arrive through the Plugin Manager — from the curated index
 * as data, or from debugpy's managed environment — so by the time an adapter is resolved, the only
 * question left is where the install put it.
 */
export class DebugAdapterLocator {
  /**
   * Holds explicit executable-path overrides keyed by binary name (the user's configured adapter path),
   * tried before any search. Empty until a later phase wires debug settings.
   */
  private readonly overrides: ReadonlyMap<string, string>;

  /**
   * Caches each binary's location lookup, so detection runs once per session per binary.
   */
  private readonly probes: Map<string, Promise<string | null>> = new Map<
    string,
    Promise<string | null>
  >();

  /**
   * Initializes a new instance of the {@link DebugAdapterLocator} class.
   * @param overrides Explicit executable paths keyed by binary name, or omitted for none.
   */
  public constructor(overrides: ReadonlyMap<string, string> = new Map<string, string>()) {
    this.overrides = overrides;
  }

  /**
   * Locates an adapter's executable, returning its absolute path or null when it cannot be found. The
   * result is cached for the session.
   * @param binary The executable name to locate.
   * @param rootPath The absolute workspace root, searched for a project-local adapter.
   * @returns Returns the executable path, or null when none is found.
   */
  public locate(binary: string, rootPath: string): Promise<string | null> {
    const key: string = `${rootPath} ${binary}`;
    let probe: Promise<string | null> | undefined = this.probes.get(key);
    if (probe === undefined) {
      probe = Promise.resolve(this.probe(binary, rootPath));
      this.probes.set(key, probe);
    }
    return probe;
  }

  /**
   * Searches the candidate paths for the first that is an existing file.
   * @param binary The executable name to locate.
   * @param rootPath The absolute workspace root.
   * @returns Returns the first existing candidate, or null when none exists.
   */
  private probe(binary: string, rootPath: string): string | null {
    const candidates: string[] = debugAdapterCandidates(
      binary,
      rootPath,
      process.env['PATH'],
      process.platform,
      this.overrides.get(binary),
    );
    for (const candidate of candidates) {
      try {
        if (existsSync(candidate) && statSync(candidate).isFile()) {
          return candidate;
        }
      } catch {
        // An unreadable candidate is skipped; the next one is tried.
      }
    }
    return null;
  }
}
