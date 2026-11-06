// Reads installed versions out of the lockfiles the Node ecosystem writes. Pure, so it is testable
// without a disk. pnpm's and Yarn's formats are read line by line rather than parsed: the plugin has no
// dependencies, and only the package name and version on each entry are wanted.

import { compareReleaseVersions } from './versions';

/**
 * Records a version, keeping the highest when a lockfile holds several of one package. The panel shows
 * one installed version per name, and these formats do not mark which one is the project's own.
 * @param versions The versions so far.
 * @param name The package name.
 * @param version The version.
 */
function record(versions: Map<string, string>, name: string, version: string): void {
  const current: string | undefined = versions.get(name);
  if (current === undefined || compareReleaseVersions(version, current) > 0) {
    versions.set(name, version);
  }
}

/**
 * Reads a `package-lock.json`, in both the modern shape (`packages` keyed by node path) and the legacy
 * one (`dependencies` keyed by name).
 * @param lock The parsed lockfile.
 * @returns Returns the installed versions by package name.
 */
export function readPackageLock(lock: Record<string, unknown>): ReadonlyMap<string, string> {
  const versions: Map<string, string> = new Map<string, string>();
  const packages: unknown = lock['packages'];
  if (typeof packages === 'object' && packages !== null) {
    for (const [key, value] of Object.entries(packages as Record<string, unknown>)) {
      const marker: number = key.lastIndexOf('node_modules/');
      if (marker === -1) {
        continue;
      }
      const name: string = key.slice(marker + 'node_modules/'.length);
      const version: unknown = (value as { version?: unknown } | null)?.version;
      if (name.length > 0 && typeof version === 'string') {
        versions.set(name, version);
      }
    }
  }
  const dependencies: unknown = lock['dependencies'];
  if (typeof dependencies === 'object' && dependencies !== null) {
    for (const [name, value] of Object.entries(dependencies as Record<string, unknown>)) {
      const version: unknown = (value as { version?: unknown } | null)?.version;
      if (!versions.has(name) && typeof version === 'string') {
        versions.set(name, version);
      }
    }
  }
  return versions;
}

/**
 * Reads a `pnpm-lock.yaml`: the entries under `packages:`, written `/name@version:` before lockfile v9,
 * `name@version:` from it, and `/name/version:` before v6. A peer suffix in brackets is not the version.
 * @param text The lockfile's text.
 * @returns Returns the installed versions by package name.
 */
export function readPnpmLock(text: string): ReadonlyMap<string, string> {
  const versions: Map<string, string> = new Map<string, string>();
  let inPackages: boolean = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\S/.test(line)) {
      inPackages = line.trimEnd() === 'packages:';
      continue;
    }
    if (!inPackages) {
      continue;
    }
    const entry: RegExpExecArray | null =
      /^ {2}['"]?\/?((?:@[^/\s@]+\/)?[^/\s@]+)[@/](\d[^:('"\s]*)/.exec(line);
    if (entry !== null) {
      record(versions, entry[1], entry[2]);
    }
  }
  return versions;
}

/**
 * Reads a `yarn.lock`, in the classic format (`version "1.0.0"`) and Berry's (`version: 1.0.0`). An
 * entry's header lists every range that resolved to it, and all of them name one package.
 * @param text The lockfile's text.
 * @returns Returns the installed versions by package name.
 */
export function readYarnLock(text: string): ReadonlyMap<string, string> {
  const versions: Map<string, string> = new Map<string, string>();
  let name: string | null = null;
  for (const line of text.split(/\r?\n/)) {
    if (line.length === 0 || line.startsWith('#')) {
      continue;
    }
    if (!line.startsWith(' ')) {
      const header: RegExpExecArray | null = /^"?((?:@[^/\s@]+\/)?[^/\s@"]+)@/.exec(line);
      name = header === null ? null : header[1];
      continue;
    }
    const version: RegExpExecArray | null = /^ {2}version:? "?([^"\s]+)"?\s*$/.exec(line);
    if (name !== null && version !== null) {
      record(versions, name, version[1]);
      name = null;
    }
  }
  return versions;
}
