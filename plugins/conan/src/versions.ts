// Conan's versions, as this plugin compares them.
//
// A Conan version is dot-separated parts, compared numerically where both are numbers and as text
// otherwise (ConanCenter has `cci.20230101` alongside `1.3.1`), with an optional prerelease after `-`
// that sorts before its release, and build metadata after `+` that does not count.

import { PackageUpdateStatus } from './protocol';

/**
 * Splits a version into its release parts and its prerelease, dropping build metadata.
 * @param version The version.
 * @returns Returns the parts and the prerelease, empty when there is none.
 */
function split(version: string): { readonly parts: readonly string[]; readonly pre: string } {
  const withoutBuild: string = version.split('+', 1)[0];
  const dash: number = withoutBuild.indexOf('-');
  const core: string = dash < 0 ? withoutBuild : withoutBuild.slice(0, dash);
  return { parts: core.split('.'), pre: dash < 0 ? '' : withoutBuild.slice(dash + 1) };
}

/**
 * Compares two parts: numerically when both are numbers, as text otherwise.
 * @param x The first part.
 * @param y The second part.
 * @returns Returns the sign of `x - y`.
 */
function compareParts(x: string, y: string): number {
  return /^\d+$/.test(x) && /^\d+$/.test(y)
    ? Number.parseInt(x, 10) - Number.parseInt(y, 10)
    : x.localeCompare(y);
}

/**
 * Compares two Conan versions.
 * @param a The first version.
 * @param b The second version.
 * @returns Returns the sign of `a - b`.
 */
export function compareVersions(a: string, b: string): number {
  const left: { readonly parts: readonly string[]; readonly pre: string } = split(a);
  const right: { readonly parts: readonly string[]; readonly pre: string } = split(b);
  const length: number = Math.max(left.parts.length, right.parts.length);
  for (let index: number = 0; index < length; index += 1) {
    const difference: number = compareParts(left.parts[index] ?? '0', right.parts[index] ?? '0');
    if (difference !== 0) {
      return difference;
    }
  }
  if (left.pre === right.pre) {
    return 0;
  }
  // A release sorts after its own prereleases.
  if (left.pre === '') {
    return 1;
  }
  if (right.pre === '') {
    return -1;
  }
  return compareParts(left.pre, right.pre);
}

/**
 * Determines whether a version is a prerelease.
 * @param version The version.
 * @returns Returns true when it has a prerelease part.
 */
export function isPrerelease(version: string): boolean {
  return split(version).pre !== '';
}

/**
 * Picks the newest version: the newest release, or the newest prerelease when there is no release.
 * @param versions The versions.
 * @returns Returns the newest, or null when there are none.
 */
export function newestVersion(versions: Iterable<string>): string | null {
  let release: string | null = null;
  let pre: string | null = null;
  for (const version of versions) {
    if (isPrerelease(version)) {
      pre = pre === null || compareVersions(version, pre) > 0 ? version : pre;
    } else {
      release = release === null || compareVersions(version, release) > 0 ? version : release;
    }
  }
  return release ?? pre;
}

/**
 * Derives a package's upgrade verdict: `unknown` when either version is missing, `outdated` when the
 * latest is strictly newer, `current` otherwise.
 * @param installed The resolved version, or null.
 * @param latest The latest version a remote has, or null.
 * @returns Returns the verdict.
 */
export function deriveStatus(installed: string | null, latest: string | null): PackageUpdateStatus {
  if (installed === null || latest === null) {
    return 'unknown';
  }
  return compareVersions(latest, installed) > 0 ? 'outdated' : 'current';
}
