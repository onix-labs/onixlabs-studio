import { PackageUpdateStatus } from '@shared/api/package-management';

/**
 * Shared version helpers used across ecosystems: comparing semantic-version release cores and deriving
 * a package's upgrade verdict. Kept free of any ecosystem or Node dependency so they are trivially
 * unit-testable and reused by every package manager.
 */

/**
 * Derives a package's upgrade verdict from its installed and latest versions: `unknown` when either is
 * missing (nothing to compare), `outdated` when the latest release is strictly newer, and `current`
 * otherwise. Prerelease suffixes are ignored so a stable install is not flagged against its own
 * prerelease line.
 * @param installed The resolved installed version, or null.
 * @param latest The latest registry version, or null.
 * @returns Returns the upgrade status.
 */
export function deriveStatus(installed: string | null, latest: string | null): PackageUpdateStatus {
  if (installed === null || latest === null) {
    return 'unknown';
  }
  return compareReleaseVersions(latest, installed) > 0 ? 'outdated' : 'current';
}

/**
 * Compares two semantic-version release cores (`major.minor.patch`), ignoring any prerelease or build
 * suffix. Returns a positive number when the first is newer, negative when older, and zero when equal.
 * A part that does not parse as a number is treated as zero, so a non-standard version degrades to a
 * best-effort comparison rather than throwing.
 * @param a The first version.
 * @param b The second version.
 * @returns Returns the sign of `a - b` by release precedence.
 */
export function compareReleaseVersions(a: string, b: string): number {
  const parse: (value: string) => readonly number[] = (value: string): readonly number[] => {
    const core: string = value.replace(/^[^0-9]*/, '').split(/[-+]/, 1)[0];
    return core.split('.').map((part: string): number => {
      const parsed: number = Number.parseInt(part, 10);
      return Number.isNaN(parsed) ? 0 : parsed;
    });
  };
  const left: readonly number[] = parse(a);
  const right: readonly number[] = parse(b);
  const length: number = Math.max(left.length, right.length);
  for (let index: number = 0; index < length; index += 1) {
    const difference: number = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}
