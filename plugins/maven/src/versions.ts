import { PackageUpdateStatus } from './protocol';

// Maven versions, as Maven orders them.
//
// Maven does not use semantic versioning: `1.0-alpha-1 < 1.0-beta < 1.0-rc1 < 1.0-SNAPSHOT < 1.0 <
// 1.0-sp1`, a qualifier it does not know (`-jre`, `-android`, `.Final`) sorts after a release, and
// `1.0` equals `1`. This is the same ordering as Maven's `ComparableVersion`, cut down to the cases
// a dependency's version actually takes.

/**
 * One part of a version: a number, or a qualifier word (lower-cased).
 */
type VersionItem = number | string;

/**
 * The qualifiers Maven knows, in order. Anything else sorts after all of them, alphabetically.
 */
const QUALIFIERS: Readonly<Record<string, number>> = {
  alpha: 1,
  a: 1,
  beta: 2,
  b: 2,
  milestone: 3,
  m: 3,
  rc: 4,
  cr: 4,
  snapshot: 5,
  '': 6,
  ga: 6,
  final: 6,
  release: 6,
  sp: 7,
};

/**
 * The rank of a qualifier that means "this is the release": the one a missing part is compared as.
 */
const RELEASE_RANK: number = 6;

/**
 * Words that mark a prerelease although Maven itself does not know them.
 */
const PRERELEASE_WORDS: ReadonlySet<string> = new Set<string>([
  'preview',
  'pre',
  'ea',
  'dev',
  'nightly',
  'canary',
  'eap',
]);

/**
 * Splits a version into its parts: at dots and dashes, and where digits meet letters.
 * @param version The version.
 * @returns Returns the parts.
 */
function items(version: string): readonly VersionItem[] {
  return (version.toLowerCase().match(/\d+|[a-z]+/g) ?? []).map((part: string): VersionItem =>
    /^\d+$/.test(part) ? Number.parseInt(part, 10) : part,
  );
}

/**
 * Ranks a qualifier word.
 * @param word The word.
 * @returns Returns its rank; words Maven does not know rank above every one it does.
 */
function rank(word: string): number {
  return QUALIFIERS[word] ?? 100;
}

/**
 * Compares two parts, either of which may be missing.
 * @param left The first part, or undefined.
 * @param right The second part, or undefined.
 * @returns Returns the sign of `left - right`.
 */
function compareItems(left: VersionItem | undefined, right: VersionItem | undefined): number {
  if (typeof left === 'number' && typeof right === 'number') {
    return left - right;
  }
  if (typeof left === 'number') {
    // A number beats any word, and a missing part against a number is a zero.
    return right === undefined ? left : 1;
  }
  if (typeof right === 'number') {
    return left === undefined ? -right : -1;
  }
  const leftRank: number = left === undefined ? RELEASE_RANK : rank(left);
  const rightRank: number = right === undefined ? RELEASE_RANK : rank(right);
  if (leftRank !== rightRank) {
    return leftRank - rightRank;
  }
  if (leftRank === 100 && left !== undefined && right !== undefined) {
    return left < right ? -1 : left > right ? 1 : 0;
  }
  return 0;
}

/**
 * Compares two Maven versions.
 * @param a The first version.
 * @param b The second version.
 * @returns Returns a positive number when `a` is newer, negative when older, zero when equal.
 */
export function compareMavenVersions(a: string, b: string): number {
  const left: readonly VersionItem[] = items(a);
  const right: readonly VersionItem[] = items(b);
  const length: number = Math.max(left.length, right.length);
  for (let index: number = 0; index < length; index += 1) {
    const difference: number = compareItems(left[index], right[index]);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

/**
 * Determines whether a version is a prerelease: an alpha, beta, milestone, release candidate or
 * snapshot, or one of the words projects commonly use for the same thing (`-preview`, `-ea`).
 * @param version The version.
 * @returns Returns true for a prerelease.
 */
export function isPrerelease(version: string): boolean {
  return items(version).some(
    (item: VersionItem): boolean =>
      typeof item === 'string' && (rank(item) < RELEASE_RANK || PRERELEASE_WORDS.has(item)),
  );
}

/**
 * Determines whether a version is one concrete version, not a range (`[1.0,2.0)`), a Gradle dynamic
 * version (`1.+`, `latest.release`) or a reference that was never resolved (`${jackson.version}`).
 * Only a concrete version can be compared with the latest.
 * @param version The version.
 * @returns Returns true when it is concrete.
 */
export function isConcreteVersion(version: string): boolean {
  return (
    /^[0-9A-Za-z][0-9A-Za-z._-]*$/.test(version) &&
    /\d/.test(version) &&
    !version.startsWith('latest.') &&
    !version.includes('+')
  );
}

/**
 * Gets a version's flavour: the word a project publishes several lines under, such as Guava's `-jre`
 * and `-android`. A user on one line wants to hear about that line.
 * @param version The version.
 * @returns Returns the flavour word, or null when there is none.
 */
function flavour(version: string): string | null {
  const last: VersionItem | undefined = items(version).at(-1);
  return typeof last === 'string' && rank(last) === 100 && !PRERELEASE_WORDS.has(last)
    ? last
    : null;
}

/**
 * Picks the latest version a repository lists: the newest release, skipping prereleases unless asked,
 * and keeping to the flavour the project is on when that flavour is published.
 * @param versions The versions the repository lists.
 * @param current The version the project is on, or null.
 * @param prerelease Whether prereleases count.
 * @returns Returns the latest version, or null when none qualifies.
 */
export function pickLatest(
  versions: readonly string[],
  current: string | null,
  prerelease: boolean,
): string | null {
  const candidates: readonly string[] = versions.filter(
    (version: string): boolean => prerelease || !isPrerelease(version),
  );
  const wanted: string | null = current === null ? null : flavour(current);
  const sameFlavour: readonly string[] =
    wanted === null
      ? []
      : candidates.filter((version: string): boolean => flavour(version) === wanted);
  const pool: readonly string[] = sameFlavour.length > 0 ? sameFlavour : candidates;
  let best: string | null = null;
  for (const version of pool) {
    if (best === null || compareMavenVersions(version, best) > 0) {
      best = version;
    }
  }
  return best;
}

/**
 * Derives a package's upgrade verdict: `unknown` when either side is missing or the project's version
 * is not one concrete version, `outdated` when the latest is newer, and `current` otherwise.
 * @param current The version the project is on, or null.
 * @param latest The latest version, or null.
 * @returns Returns the verdict.
 */
export function deriveStatus(current: string | null, latest: string | null): PackageUpdateStatus {
  if (current === null || latest === null || !isConcreteVersion(current)) {
    return 'unknown';
  }
  return compareMavenVersions(latest, current) > 0 ? 'outdated' : 'current';
}
