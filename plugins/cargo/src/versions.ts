import { PackageUpdateStatus } from './protocol';

// Version helpers. Cargo versions are semantic versions, prerelease and all, so these follow SemVer 2.0
// precedence rather than comparing release cores only: a registry answering `1.0.0-rc.2` and
// `1.0.0-rc.10` must pick the second.

/**
 * Matches a semantic version: the release core, an optional prerelease, an optional build.
 */
const SEMVER: RegExp = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

/**
 * A semantic version read into its parts.
 */
interface SemanticVersion {
  /**
   * Gets the major, minor and patch numbers.
   */
  readonly core: readonly [number, number, number];

  /**
   * Gets the prerelease identifiers, empty for a release.
   */
  readonly prerelease: readonly string[];
}

/**
 * Reads a semantic version.
 * @param version The version.
 * @returns Returns its parts, or null when it is not a semantic version.
 */
function parse(version: string): SemanticVersion | null {
  const match: RegExpExecArray | null = SEMVER.exec(version.trim());
  if (match === null) {
    return null;
  }
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] === undefined ? [] : match[4].split('.'),
  };
}

/**
 * Determines whether a version is a prerelease (`1.0.0-beta.1`).
 * @param version The version.
 * @returns Returns true for a prerelease; false for a release or something that is not a version.
 */
export function isPrerelease(version: string): boolean {
  return (parse(version)?.prerelease.length ?? 0) > 0;
}

/**
 * Compares two semantic versions by SemVer precedence: the release core, then a prerelease sorts
 * before its release, then prerelease identifiers left to right (numeric ones numerically, and below
 * alphanumeric ones). Build metadata is ignored. A version that does not parse sorts below every one
 * that does, so it is never chosen as the latest.
 * @param a The first version.
 * @param b The second version.
 * @returns Returns a positive number when `a` is newer, negative when older, zero when equal.
 */
export function compareVersions(a: string, b: string): number {
  const left: SemanticVersion | null = parse(a);
  const right: SemanticVersion | null = parse(b);
  if (left === null || right === null) {
    return (left === null ? 0 : 1) - (right === null ? 0 : 1);
  }
  for (let index: number = 0; index < 3; index += 1) {
    const difference: number = left.core[index] - right.core[index];
    if (difference !== 0) {
      return difference;
    }
  }
  if (left.prerelease.length === 0 || right.prerelease.length === 0) {
    return right.prerelease.length - left.prerelease.length;
  }
  const length: number = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index: number = 0; index < length; index += 1) {
    const difference: number = compareIdentifier(left.prerelease[index], right.prerelease[index]);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

/**
 * Compares two prerelease identifiers. A missing one sorts first: `1.0.0-alpha` < `1.0.0-alpha.1`.
 * @param a The first identifier.
 * @param b The second identifier.
 * @returns Returns the sign of `a - b`.
 */
function compareIdentifier(a: string | undefined, b: string | undefined): number {
  if (a === undefined || b === undefined) {
    return (a === undefined ? 0 : 1) - (b === undefined ? 0 : 1);
  }
  const numeric: RegExp = /^\d+$/;
  if (numeric.test(a) && numeric.test(b)) {
    return Number(a) - Number(b);
  }
  if (numeric.test(a) !== numeric.test(b)) {
    return numeric.test(a) ? -1 : 1;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Reads the version a requirement starts from, for comparing against the latest when nothing is
 * installed: `^1.2` is `1.2.0`, `=0.4.1` is `0.4.1`, `>=1, <2` is `1.0.0`. A wildcard alone has none.
 * @param requirement The requirement as declared.
 * @returns Returns the version, or null when there is none.
 */
export function floorOf(requirement: string): string | null {
  const match: RegExpExecArray | null = /(\d+)(?:\.(\d+))?(?:\.(\d+))?(-[0-9A-Za-z.-]+)?/.exec(
    requirement,
  );
  if (match === null) {
    return null;
  }
  return `${match[1]}.${match[2] ?? '0'}.${match[3] ?? '0'}${match[4] ?? ''}`;
}

/**
 * Derives a package's upgrade verdict: `unknown` when either version is missing, `outdated` when the
 * latest is strictly newer, `current` otherwise.
 * @param installed The installed version, or the requirement's floor when nothing is installed.
 * @param latest The latest version the registry offers.
 * @returns Returns the verdict.
 */
export function deriveStatus(installed: string | null, latest: string | null): PackageUpdateStatus {
  if (installed === null || latest === null) {
    return 'unknown';
  }
  return compareVersions(latest, installed) > 0 ? 'outdated' : 'current';
}
