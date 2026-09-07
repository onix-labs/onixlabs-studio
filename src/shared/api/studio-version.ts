// Ordering for Studio's own published version string, which is calendar-versioned (`YYYY.MINOR.PATCH`)
// with an optional prerelease suffix (`-beta.4`, `-rc.1`). Kept platform-neutral — types and pure
// functions only — so the renderer's setup gate and anything in main can share one notion of "newer".
//
// This deliberately does NOT reuse `compareReleaseVersions` from the package-management helpers. That
// function strips prerelease suffixes before comparing, which is right for deciding whether a
// dependency is outdated (a stable install should not be flagged against its own prerelease line) and
// fatal here: it makes every beta in a release line compare equal, so `2026.1.0-beta.4` and
// `2026.1.0-beta.5` would be the same version and an upgrade would go unnoticed.

/**
 * Splits a version into its numeric release core and its prerelease identifiers, discarding any build
 * metadata (`+sha`), which carries no precedence.
 *
 * Parsing is deliberately forgiving: a core part that is not a number counts as zero, and a version
 * with no recognisable core at all yields an empty core that compares as all-zeroes. A version string
 * is read from a build's own metadata, so a malformed one is a packaging accident — it should degrade
 * to a best-effort ordering rather than throw somewhere the user cannot act on it.
 * @param version The version string.
 * @returns Returns the release core parts and the prerelease identifiers.
 */
function parse(version: string): { core: readonly number[]; prerelease: readonly string[] } {
  // Leading non-digits (a `v` prefix) are dropped; build metadata is cut before the prerelease split
  // so a `+` inside it can never be mistaken for an identifier separator.
  const withoutBuild: string = version.replace(/^[^0-9]*/, '').split('+', 1)[0];
  const separator: number = withoutBuild.indexOf('-');
  const core: string = separator === -1 ? withoutBuild : withoutBuild.slice(0, separator);
  const suffix: string = separator === -1 ? '' : withoutBuild.slice(separator + 1);

  return {
    core: core
      .split('.')
      .filter((part: string): boolean => part.length > 0)
      .map((part: string): number => {
        const parsed: number = Number.parseInt(part, 10);
        return Number.isNaN(parsed) ? 0 : parsed;
      }),
    prerelease: suffix.length === 0 ? [] : suffix.split('.'),
  };
}

/**
 * Determines whether an identifier is purely numeric, which decides how it is compared. `beta.10`
 * must sort after `beta.9`, and only a numeric comparison gets that right — lexically, `10` precedes
 * `9`.
 * @param identifier The prerelease identifier.
 * @returns Returns true when the identifier is a run of digits.
 */
function isNumeric(identifier: string): boolean {
  return identifier.length > 0 && /^[0-9]+$/.test(identifier);
}

/**
 * Compares two prerelease identifier lists by the standard precedence rules: identifier by
 * identifier, numeric ones numerically and the rest lexically, a numeric identifier ranking below an
 * alphanumeric one, and — when one list is a prefix of the other — the shorter list ranking lower.
 *
 * The caller has already established that neither list is empty, because an absent prerelease is not
 * a lower prerelease: it is the release itself, which outranks every prerelease of the same core.
 * @param left The first identifier list.
 * @param right The second identifier list.
 * @returns Returns a negative number when the first is lower, positive when higher, and zero when
 * they are equal.
 */
function comparePrerelease(left: readonly string[], right: readonly string[]): number {
  const length: number = Math.min(left.length, right.length);
  for (let index: number = 0; index < length; index += 1) {
    const a: string = left[index];
    const b: string = right[index];
    if (a === b) {
      continue;
    }
    if (isNumeric(a) && isNumeric(b)) {
      return Number.parseInt(a, 10) - Number.parseInt(b, 10);
    }
    // A numeric identifier always ranks below an alphanumeric one, so `beta.1` precedes `beta.final`.
    if (isNumeric(a) !== isNumeric(b)) {
      return isNumeric(a) ? -1 : 1;
    }
    return a < b ? -1 : 1;
  }
  return left.length - right.length;
}

/**
 * Compares two Studio version strings by release precedence, so `2026.1.0-beta.4` is older than
 * `2026.1.0-beta.5`, which is older than `2026.1.0`, which is older than `2026.2.0`.
 * @param a The first version.
 * @param b The second version.
 * @returns Returns a negative number when the first is older, positive when newer, and zero when the
 * two carry the same precedence.
 */
export function compareStudioVersions(a: string, b: string): number {
  const left: { core: readonly number[]; prerelease: readonly string[] } = parse(a);
  const right: { core: readonly number[]; prerelease: readonly string[] } = parse(b);

  const length: number = Math.max(left.core.length, right.core.length);
  for (let index: number = 0; index < length; index += 1) {
    const difference: number = (left.core[index] ?? 0) - (right.core[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }

  // Same core: a version carrying a prerelease is the run-up to the one that does not, so it ranks
  // below it. Two prereleases of the same core are then ordered against each other.
  if (left.prerelease.length === 0 || right.prerelease.length === 0) {
    return right.prerelease.length - left.prerelease.length;
  }
  return comparePrerelease(left.prerelease, right.prerelease);
}

/**
 * Determines whether a version is strictly newer than another.
 * @param version The version to test.
 * @param baseline The version to test against.
 * @returns Returns true when the version has higher precedence than the baseline.
 */
export function isNewerStudioVersion(version: string, baseline: string): boolean {
  return compareStudioVersions(version, baseline) > 0;
}
