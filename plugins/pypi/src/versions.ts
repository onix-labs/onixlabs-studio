// Python versions, per PEP 440: enough of it to rank an index's releases, tell a prerelease from a
// release, and say whether an installed version is behind. A version PEP 440 does not describe (an old
// "legacy" one) ranks below every one it does, and is never offered as the latest.

import { PackageUpdateStatus } from './protocol';

/**
 * A version, read into the parts PEP 440 orders by.
 */
interface ParsedVersion {
  /**
   * Gets the epoch, `N!`, zero when absent.
   */
  readonly epoch: number;

  /**
   * Gets the release numbers, `1.2.3`.
   */
  readonly release: readonly number[];

  /**
   * Gets the pre-release phase and number, `a1` / `b2` / `rc3`, or null.
   */
  readonly pre: readonly [number, number] | null;

  /**
   * Gets the post-release number, or null.
   */
  readonly post: number | null;

  /**
   * Gets the development-release number, or null.
   */
  readonly dev: number | null;

  /**
   * Gets the local label's parts, `+ubuntu.1`, empty when absent.
   */
  readonly local: readonly (number | string)[];
}

/**
 * Matches a version as PEP 440 allows it to be written, before normalisation (its appendix's pattern).
 */
const VERSION: RegExp =
  /^v?(?:(\d+)!)?(\d+(?:\.\d+)*)(?:[-_.]?(a|b|c|rc|alpha|beta|pre|preview)[-_.]?(\d+)?)?(?:-(\d+)|[-_.]?(post|rev|r)[-_.]?(\d+)?)?(?:[-_.]?(dev)[-_.]?(\d+)?)?(?:\+([a-z0-9]+(?:[-_.][a-z0-9]+)*))?$/i;

/**
 * Orders the pre-release phases: alpha, then beta, then release candidate.
 */
const PHASE: Readonly<Record<string, number>> = {
  a: 0,
  alpha: 0,
  b: 1,
  beta: 1,
  c: 2,
  rc: 2,
  pre: 2,
  preview: 2,
};

/**
 * Reads a version.
 * @param version The version.
 * @returns Returns its parts, or null when PEP 440 does not describe it.
 */
function parse(version: string): ParsedVersion | null {
  const match: RegExpExecArray | null = VERSION.exec(version.trim());
  if (match === null) {
    return null;
  }
  const number: (text: string | undefined) => number = (text: string | undefined): number =>
    text === undefined ? 0 : Number.parseInt(text, 10);
  const post: number | null =
    match[5] !== undefined ? number(match[5]) : match[6] !== undefined ? number(match[7]) : null;
  return {
    epoch: number(match[1]),
    release: match[2].split('.').map((part: string): number => Number.parseInt(part, 10)),
    pre: match[3] !== undefined ? [PHASE[match[3].toLowerCase()], number(match[4])] : null,
    post,
    dev: match[8] !== undefined ? number(match[9]) : null,
    local:
      match[10] === undefined
        ? []
        : match[10]
            .toLowerCase()
            .split(/[-_.]/)
            .map((part: string): number | string => (/^\d+$/.test(part) ? Number(part) : part)),
  };
}

/**
 * Determines whether a version is one PEP 440 describes.
 * @param version The version.
 * @returns Returns true when it is.
 */
export function isValidVersion(version: string): boolean {
  return parse(version) !== null;
}

/**
 * Determines whether a version is a pre-release or a development release, which "latest" skips.
 * @param version The version.
 * @returns Returns true when it is one; a version PEP 440 does not describe counts as one, since what
 * it is cannot be told.
 */
export function isPrerelease(version: string): boolean {
  const parsed: ParsedVersion | null = parse(version);
  return parsed?.pre !== null || parsed.dev !== null;
}

/**
 * Compares two versions by PEP 440's ordering.
 * @param a The first version.
 * @param b The second version.
 * @returns Returns a positive number when the first is newer, a negative one when it is older, and
 * zero when they are the same version (`1.0` and `1.0.0` are).
 */
export function compareVersions(a: string, b: string): number {
  const left: ParsedVersion | null = parse(a);
  const right: ParsedVersion | null = parse(b);
  if (left === null || right === null) {
    return (left === null ? 0 : 1) - (right === null ? 0 : 1);
  }
  return compareParsed(left, right);
}

/**
 * Picks the newest release from a list of versions: the newest that is not a pre-release, or, when
 * there are only pre-releases, the newest of those (what PyPI itself calls a project's version then).
 * @param versions The versions.
 * @returns Returns the newest, or null when none is a version PEP 440 describes.
 */
export function newestRelease(versions: Iterable<string>): string | null {
  let stable: string | null = null;
  let any: string | null = null;
  for (const version of versions) {
    if (!isValidVersion(version)) {
      continue;
    }
    if (any === null || compareVersions(version, any) > 0) {
      any = version;
    }
    if (!isPrerelease(version) && (stable === null || compareVersions(version, stable) > 0)) {
      stable = version;
    }
  }
  return stable ?? any;
}

/**
 * Derives a package's upgrade verdict from its installed and latest versions: `unknown` when either is
 * missing or is not a version PEP 440 describes, `outdated` when the latest is newer, and `current`
 * otherwise.
 * @param installed The installed version, or null.
 * @param latest The latest version, or null.
 * @returns Returns the upgrade status.
 */
export function deriveStatus(installed: string | null, latest: string | null): PackageUpdateStatus {
  if (installed === null || latest === null || !isValidVersion(installed)) {
    return 'unknown';
  }
  if (!isValidVersion(latest)) {
    return 'unknown';
  }
  return compareVersions(latest, installed) > 0 ? 'outdated' : 'current';
}

/**
 * Compares two read versions, by the sort key PEP 440 sets out (as `packaging` builds it).
 * @param left The first.
 * @param right The second.
 * @returns Returns the sign of the difference.
 */
function compareParsed(left: ParsedVersion, right: ParsedVersion): number {
  if (left.epoch !== right.epoch) {
    return left.epoch - right.epoch;
  }
  const length: number = Math.max(left.release.length, right.release.length);
  for (let index: number = 0; index < length; index += 1) {
    const difference: number = (left.release[index] ?? 0) - (right.release[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  const keys: readonly (readonly [number, number])[] = [
    [preKey(left), preKey(right)],
    [left.post ?? -Infinity, right.post ?? -Infinity],
    [left.dev ?? Infinity, right.dev ?? Infinity],
  ];
  for (const [a, b] of keys) {
    if (a !== b) {
      return a < b ? -1 : 1;
    }
  }
  return compareLocal(left.local, right.local);
}

/**
 * Builds the one number a version's pre-release part sorts by: a development release of a final
 * release sorts before its pre-releases, and a final release after them.
 * @param version The version.
 * @returns Returns the key.
 */
function preKey(version: ParsedVersion): number {
  if (version.pre !== null) {
    // A phase's numbers stay well under a million in practice, so this keeps phase order first.
    return version.pre[0] * 1_000_000 + version.pre[1];
  }
  return version.post === null && version.dev !== null ? -Infinity : Infinity;
}

/**
 * Compares two local labels: none sorts first, numbers above words, then part by part.
 * @param left The first label's parts.
 * @param right The second label's parts.
 * @returns Returns the sign of the difference.
 */
function compareLocal(
  left: readonly (number | string)[],
  right: readonly (number | string)[],
): number {
  const length: number = Math.max(left.length, right.length);
  for (let index: number = 0; index < length; index += 1) {
    const a: number | string | undefined = left[index];
    const b: number | string | undefined = right[index];
    if (a === b) {
      continue;
    }
    if (a === undefined || b === undefined) {
      return a === undefined ? -1 : 1;
    }
    if (typeof a !== typeof b) {
      return typeof a === 'number' ? 1 : -1;
    }
    return a < b ? -1 : 1;
  }
  return 0;
}
