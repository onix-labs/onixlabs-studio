// Reads `Cargo.lock` for the installed column: which version of each dependency the workspace resolved.

import { arrayOf, stringOf, tableOf, TomlTable, TomlValue } from './toml';

/**
 * One `[[package]]` of a lockfile.
 */
export interface LockedPackage {
  /**
   * Gets the crate's name.
   */
  readonly name: string;

  /**
   * Gets the version it resolved to.
   */
  readonly version: string;

  /**
   * Gets where it came from (`registry+…`, `sparse+…`, `git+…`), or null for a workspace or path crate.
   */
  readonly source: string | null;

  /**
   * Gets its dependencies as the lockfile writes them: `name`, `name version` or `name version (source)`.
   */
  readonly dependencies: readonly string[];
}

/**
 * Reads a parsed `Cargo.lock`'s packages, skipping any entry without a name and a version.
 * @param document The parsed lockfile.
 * @returns Returns the packages.
 */
export function readLockfile(document: TomlTable): readonly LockedPackage[] {
  const packages: LockedPackage[] = [];
  for (const entry of arrayOf(document['package'])) {
    const table: TomlTable | null = tableOf(entry);
    const name: string | null = stringOf(table?.['name']);
    const version: string | null = stringOf(table?.['version']);
    if (table === null || name === null || version === null) {
      continue;
    }
    packages.push({
      name,
      version,
      source: stringOf(table['source']),
      dependencies: arrayOf(table['dependencies']).filter(
        (value: TomlValue): value is string => typeof value === 'string',
      ),
    });
  }
  return packages;
}

/**
 * Finds the version a crate's dependency resolved to.
 *
 * A lockfile can hold several versions of one crate, so the crate's own entry is read first: its
 * `dependencies` list names the version when there is more than one (`serde 1.0.200`) and only the name
 * when there is one. Without the crate's entry, a single locked version of the name is the answer and
 * several are no answer at all — guessing would show a version the crate does not use.
 * @param packages The lockfile's packages.
 * @param crate The crate's name and version.
 * @param dependency The crate name the dependency resolves to (its `package`, not its key).
 * @returns Returns the version, or null when the lockfile does not say.
 */
export function lockedVersion(
  packages: readonly LockedPackage[],
  crate: { readonly name: string; readonly version: string | null },
  dependency: string,
): string | null {
  const candidates: readonly LockedPackage[] = packages.filter(
    (entry: LockedPackage): boolean => entry.name === dependency,
  );
  const own: LockedPackage | undefined =
    packages.find(
      (entry: LockedPackage): boolean =>
        entry.name === crate.name && entry.source === null && entry.version === crate.version,
    ) ??
    packages.find(
      (entry: LockedPackage): boolean => entry.name === crate.name && entry.source === null,
    );
  const named: string | undefined = own?.dependencies.find(
    (line: string): boolean => line.split(' ')[0] === dependency,
  );
  const version: string | undefined = named?.split(' ')[1];
  if (version !== undefined) {
    return version;
  }
  return candidates.length === 1 ? candidates[0].version : null;
}
