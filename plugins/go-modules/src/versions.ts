import { PackageUpdateStatus } from './protocol';

// Go module versions are semantic versions with a leading `v` (`v1.2.3`, `v1.2.3-rc.1`), plus two
// Go-specific shapes: a pseudo-version (`v0.0.0-20231010123456-abcdef123456`), which is a prerelease
// by construction and so orders correctly under plain semver, and `+incompatible`, a build suffix that
// marks a v2+ tag on a module with no go.mod. Comparing them is therefore semver precedence, with the
// prerelease part honoured rather than dropped: a pseudo-version of a commit after v1.2.3 is
// `v1.2.4-0.<time>-<hash>`, which must order above v1.2.3 and below v1.2.4.

/**
 * Matches a Go module version: `v`, three numeric parts, an optional prerelease and an optional build.
 */
const SEMVER: RegExp =
  /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

/**
 * A version taken apart for comparison.
 */
interface ParsedVersion {
  /**
   * Gets the major, minor and patch numbers.
   */
  readonly core: readonly [number, number, number];

  /**
   * Gets the dot-separated prerelease identifiers, empty for a release.
   */
  readonly prerelease: readonly string[];

  /**
   * Gets whether the version carries `+incompatible`.
   */
  readonly incompatible: boolean;
}

/**
 * Parses a Go module version.
 * @param version The version.
 * @returns Returns its parts, or null when it is not a semantic version.
 */
function parse(version: string): ParsedVersion | null {
  const match: RegExpExecArray | null = SEMVER.exec(version);
  if (match === null) {
    return null;
  }
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] === undefined ? [] : match[4].split('.'),
    incompatible: match[5] === 'incompatible',
  };
}

/**
 * Determines whether a string is a valid Go module version (a canonical semantic version with `v`).
 * @param version The candidate.
 * @returns Returns true when it is one.
 */
export function isGoVersion(version: string): boolean {
  return parse(version) !== null;
}

/**
 * Determines whether a version is a prerelease, which includes every pseudo-version.
 * @param version The version.
 * @returns Returns true for a prerelease; false for a release or something that is not a version.
 */
export function isPrerelease(version: string): boolean {
  return (parse(version)?.prerelease.length ?? 0) > 0;
}

/**
 * Determines whether a version carries `+incompatible`.
 * @param version The version.
 * @returns Returns true when it does.
 */
export function isIncompatible(version: string): boolean {
  return parse(version)?.incompatible === true;
}

/**
 * Compares two prerelease identifiers by semver's rules: numeric ones numerically and below
 * alphanumeric ones, which compare as ASCII text.
 * @param a The first identifier.
 * @param b The second identifier.
 * @returns Returns the sign of `a - b`.
 */
function compareIdentifier(a: string, b: string): number {
  const numericA: boolean = /^\d+$/.test(a);
  const numericB: boolean = /^\d+$/.test(b);
  if (numericA && numericB) {
    return Math.sign(Number(a) - Number(b));
  }
  if (numericA !== numericB) {
    return numericA ? -1 : 1;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Compares two Go module versions by semantic-version precedence. Build metadata (`+incompatible`)
 * does not take part, as semver says. Something that is not a version orders below every version, so a
 * stray line in a proxy's list never wins.
 * @param a The first version.
 * @param b The second version.
 * @returns Returns a positive number when `a` is newer, negative when older, and zero when equal.
 */
export function compareGoVersions(a: string, b: string): number {
  const left: ParsedVersion | null = parse(a);
  const right: ParsedVersion | null = parse(b);
  if (left === null || right === null) {
    return left === right ? 0 : left === null ? -1 : 1;
  }
  for (let index: number = 0; index < 3; index += 1) {
    const difference: number = left.core[index] - right.core[index];
    if (difference !== 0) {
      return Math.sign(difference);
    }
  }
  // A release outranks every prerelease of the same core.
  if (left.prerelease.length === 0 || right.prerelease.length === 0) {
    return Math.sign(right.prerelease.length - left.prerelease.length);
  }
  const length: number = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index: number = 0; index < length; index += 1) {
    const l: string | undefined = left.prerelease[index];
    const r: string | undefined = right.prerelease[index];
    if (l === undefined || r === undefined) {
      return l === undefined ? -1 : 1;
    }
    const difference: number = compareIdentifier(l, r);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

/**
 * Picks the version `go get <module>@latest` would choose from a proxy's version list, the way the go
 * command does: the highest release, or the highest prerelease when there is no release. Excluded
 * versions are never chosen. A `+incompatible` version is chosen only when the module has nothing
 * else, or when the module is itself required at an incompatible version: a module that has adopted
 * go.mod does not move onto an old major's tags.
 * @param versions The versions the proxy lists, in any order.
 * @param excluded The versions the main module excludes.
 * @param current The version currently required, or null.
 * @returns Returns the version, or null when the list holds none that can be chosen.
 */
export function pickLatest(
  versions: readonly string[],
  excluded: ReadonlySet<string>,
  current: string | null,
): string | null {
  const candidates: readonly string[] = versions.filter(
    (version: string): boolean => isGoVersion(version) && !excluded.has(version),
  );
  const compatible: readonly string[] = candidates.filter(
    (version: string): boolean => !isIncompatible(version),
  );
  const pool: readonly string[] =
    compatible.length > 0 && !(current !== null && isIncompatible(current))
      ? compatible
      : candidates;
  const releases: readonly string[] = pool.filter(
    (version: string): boolean => !isPrerelease(version),
  );
  const chosen: readonly string[] = releases.length > 0 ? releases : pool;
  return chosen.reduce<string | null>(
    (best: string | null, version: string): string | null =>
      best === null || compareGoVersions(version, best) > 0 ? version : best,
    null,
  );
}

/**
 * Derives a module's upgrade verdict from its selected and latest versions: `unknown` when either is
 * missing, `outdated` when the latest is strictly newer, and `current` otherwise. A pseudo-version
 * ahead of the latest tag is current, which is what it is.
 * @param selected The selected version, or null.
 * @param latest The latest version on the proxy, or null.
 * @returns Returns the upgrade status.
 */
export function deriveStatus(selected: string | null, latest: string | null): PackageUpdateStatus {
  if (selected === null || latest === null) {
    return 'unknown';
  }
  return compareGoVersions(latest, selected) > 0 ? 'outdated' : 'current';
}
