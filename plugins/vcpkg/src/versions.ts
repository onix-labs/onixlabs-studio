// vcpkg's versions, as this plugin compares them.
//
// A port's version is one of four schemes (`version`, `version-semver`, `version-date`,
// `version-string`) plus a `port-version`, a counter bumped when the port's packaging changes and the
// upstream version does not. vcpkg writes the pair as `1.3.1#3`, and so does this plugin, so the panel
// shows the same text `vcpkg` prints. A port-version of 0 is left off, as vcpkg does.

import { PackageUpdateStatus } from './protocol';

/**
 * Writes a version and its port-version the way vcpkg does: `1.3.1#3`, or `1.3.1` when it is 0.
 * @param version The upstream version.
 * @param portVersion The port-version.
 * @returns Returns the combined text.
 */
export function formatVersion(version: string, portVersion: number): string {
  return portVersion > 0 ? `${version}#${portVersion}` : version;
}

/**
 * Splits `1.3.1#3` into its version and port-version.
 * @param text The combined text.
 * @returns Returns the parts, the port-version 0 when absent or unreadable.
 */
function split(text: string): { readonly version: string; readonly port: number } {
  const hash: number = text.lastIndexOf('#');
  if (hash < 0) {
    return { version: text, port: 0 };
  }
  const port: number = Number.parseInt(text.slice(hash + 1), 10);
  return { version: text.slice(0, hash), port: Number.isNaN(port) ? 0 : port };
}

/**
 * Compares two vcpkg versions: the upstream version part by part (`.` and `-` both separate, which
 * orders dotted versions and `version-date`s alike), numerically where both parts are numbers and as
 * text otherwise, then the port-version. A `version-string` has no order vcpkg knows either, so two
 * different ones compare as text, which at least says "different".
 * @param a The first version.
 * @param b The second version.
 * @returns Returns the sign of `a - b`.
 */
export function compareVersions(a: string, b: string): number {
  const left: { readonly version: string; readonly port: number } = split(a);
  const right: { readonly version: string; readonly port: number } = split(b);
  const leftParts: readonly string[] = left.version.split(/[.-]/);
  const rightParts: readonly string[] = right.version.split(/[.-]/);
  const length: number = Math.max(leftParts.length, rightParts.length);
  for (let index: number = 0; index < length; index += 1) {
    const x: string = leftParts[index] ?? '0';
    const y: string = rightParts[index] ?? '0';
    const difference: number =
      /^\d+$/.test(x) && /^\d+$/.test(y)
        ? Number.parseInt(x, 10) - Number.parseInt(y, 10)
        : x.localeCompare(y);
    if (difference !== 0) {
      return difference;
    }
  }
  return left.port - right.port;
}

/**
 * Derives a port's upgrade verdict: `unknown` when either version is missing, `outdated` when the
 * latest is strictly newer, `current` otherwise.
 * @param installed The version the manifest resolves to, or null.
 * @param latest The version the registry's current baseline has, or null.
 * @returns Returns the verdict.
 */
export function deriveStatus(installed: string | null, latest: string | null): PackageUpdateStatus {
  if (installed === null || latest === null) {
    return 'unknown';
  }
  return compareVersions(latest, installed) > 0 ? 'outdated' : 'current';
}
