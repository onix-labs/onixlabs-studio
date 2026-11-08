// Reads a Gradle version catalog (`gradle/libs.versions.toml`) and resolves a script's `libs.…`
// references through it.
//
// A catalog's `[versions]` name versions, `[libraries]` name modules (with a version, a `version.ref`
// into `[versions]`, or none when a platform manages it) and `[bundles]` name groups of libraries. A
// script reaches them through accessors in which `-`, `_` and `.` all become `.`: the library
// `jackson-databind` is `libs.jackson.databind`. Only the default catalog, `libs`, is read; a catalog a
// settings script creates under another name is not.

import { isTable, parseToml, TomlTable, TomlValue } from './toml';

/**
 * A library the catalog names.
 */
export interface CatalogLibrary {
  /**
   * Gets the module, `group:artifact`.
   */
  readonly module: string;

  /**
   * Gets the version, or null when the catalog gives none (a platform manages it) or names a version
   * it does not define.
   */
  readonly version: string | null;
}

/**
 * A read catalog.
 */
export interface VersionCatalog {
  /**
   * Gets the libraries, by normalised accessor.
   */
  readonly libraries: ReadonlyMap<string, CatalogLibrary>;

  /**
   * Gets each bundle's libraries' accessors, by the bundle's normalised accessor.
   */
  readonly bundles: ReadonlyMap<string, readonly string[]>;
}

/**
 * A catalog with nothing in it, for a build with none.
 */
export const EMPTY_CATALOG: VersionCatalog = {
  libraries: new Map<string, CatalogLibrary>(),
  bundles: new Map<string, readonly string[]>(),
};

/**
 * Normalises an alias or accessor the way Gradle does: separators become dots, and case is ignored.
 * @param alias The alias.
 * @returns Returns the normalised accessor.
 */
export function normaliseAlias(alias: string): string {
  return alias.replace(/[-_]/g, '.').toLowerCase();
}

/**
 * Reads a version, which is either a string or a rich version (`{ strictly, require, prefer }`).
 * @param value The value.
 * @returns Returns the version, or null.
 */
function readVersion(value: TomlValue | undefined): string | null {
  if (typeof value === 'string') {
    return value;
  }
  if (isTable(value)) {
    for (const key of ['require', 'strictly', 'prefer']) {
      const candidate: TomlValue | undefined = value[key];
      if (typeof candidate === 'string') {
        return candidate;
      }
    }
  }
  return null;
}

/**
 * Reads one library entry: `"g:a:v"`, or a table with `module` or `group` and `name`, and `version`,
 * `version.ref` or none.
 * @param value The entry.
 * @param versions The catalog's versions.
 * @returns Returns the library, or null when it names no module.
 */
function readLibrary(
  value: TomlValue,
  versions: ReadonlyMap<string, string | null>,
): CatalogLibrary | null {
  if (typeof value === 'string') {
    const parts: readonly string[] = value.split(':');
    return parts.length < 2
      ? null
      : { module: `${parts[0]}:${parts[1]}`, version: parts[2] ?? null };
  }
  if (!isTable(value)) {
    return null;
  }
  const moduleValue: TomlValue | undefined = value['module'];
  const group: TomlValue | undefined = value['group'];
  const name: TomlValue | undefined = value['name'];
  const module: string | null =
    typeof moduleValue === 'string'
      ? moduleValue
      : typeof group === 'string' && typeof name === 'string'
        ? `${group}:${name}`
        : null;
  if (!module?.includes(':')) {
    return null;
  }
  const version: TomlValue | undefined = value['version'];
  const reference: TomlValue | undefined = isTable(version) ? version['ref'] : undefined;
  return {
    module,
    version:
      typeof reference === 'string' ? (versions.get(reference) ?? null) : readVersion(version),
  };
}

/**
 * Reads a catalog.
 * @param text The TOML.
 * @returns Returns the catalog.
 */
export function parseVersionCatalog(text: string): VersionCatalog {
  const document: TomlTable = parseToml(text);
  const table: (name: string) => TomlTable = (name: string): TomlTable => {
    const value: TomlValue | undefined = document[name];
    return isTable(value) ? value : {};
  };
  const versions: Map<string, string | null> = new Map<string, string | null>();
  for (const [key, value] of Object.entries(table('versions'))) {
    versions.set(key, readVersion(value));
  }
  const libraries: Map<string, CatalogLibrary> = new Map<string, CatalogLibrary>();
  for (const [alias, value] of flatten(table('libraries'))) {
    const library: CatalogLibrary | null = readLibrary(value, versions);
    if (library !== null) {
      libraries.set(normaliseAlias(alias), library);
    }
  }
  const bundles: Map<string, readonly string[]> = new Map<string, readonly string[]>();
  for (const [alias, value] of Object.entries(table('bundles'))) {
    if (Array.isArray(value)) {
      bundles.set(
        normaliseAlias(alias),
        value
          .filter((entry: TomlValue): entry is string => typeof entry === 'string')
          .map(normaliseAlias),
      );
    }
  }
  return { libraries, bundles };
}

/**
 * Flattens a `[libraries]` table whose aliases were written as dotted keys (`jackson.core = "…"`), which
 * TOML reads as nested tables, back into one alias per library.
 * @param table The table.
 * @param prefix The alias so far.
 * @returns Returns each alias and its entry.
 */
function flatten(table: TomlTable, prefix: string = ''): readonly [string, TomlValue][] {
  const entries: [string, TomlValue][] = [];
  for (const [key, value] of Object.entries(table)) {
    const alias: string = prefix.length === 0 ? key : `${prefix}.${key}`;
    if (
      isTable(value) &&
      value['module'] === undefined &&
      value['group'] === undefined &&
      value['name'] === undefined
    ) {
      entries.push(...flatten(value, alias));
    } else {
      entries.push([alias, value]);
    }
  }
  return entries;
}

/**
 * Resolves a script's catalog reference (the accessor after `libs.`) to the libraries it means: one
 * library, or a bundle's. An accessor may carry a trailing call Gradle's Kotlin DSL needs, so the
 * longest alias it starts with is taken.
 * @param catalog The catalog.
 * @param accessor The accessor, such as `jackson.databind` or `bundles.testing`.
 * @returns Returns the libraries, with the alias each came from; none when it names nothing.
 */
export function resolveCatalogReference(
  catalog: VersionCatalog,
  accessor: string,
): readonly { alias: string; library: CatalogLibrary }[] {
  const normalised: string = normaliseAlias(accessor);
  if (normalised.startsWith('bundles.')) {
    const bundle: readonly string[] | undefined = longest(
      catalog.bundles,
      normalised.slice('bundles.'.length),
    );
    return (bundle ?? [])
      .map((alias: string): { alias: string; library: CatalogLibrary } | null => {
        const library: CatalogLibrary | undefined = catalog.libraries.get(alias);
        return library === undefined ? null : { alias, library };
      })
      .filter(
        (
          entry: { alias: string; library: CatalogLibrary } | null,
        ): entry is { alias: string; library: CatalogLibrary } => entry !== null,
      );
  }
  if (normalised.startsWith('versions.') || normalised.startsWith('plugins.')) {
    return [];
  }
  const parts: readonly string[] = normalised.split('.');
  for (let length: number = parts.length; length > 0; length -= 1) {
    const alias: string = parts.slice(0, length).join('.');
    const library: CatalogLibrary | undefined = catalog.libraries.get(alias);
    if (library !== undefined) {
      return [{ alias, library }];
    }
  }
  return [];
}

/**
 * Finds the entry for the longest key an accessor starts with.
 * @param map The entries.
 * @param accessor The normalised accessor.
 * @returns Returns the entry, or undefined.
 */
function longest<T>(map: ReadonlyMap<string, T>, accessor: string): T | undefined {
  const parts: readonly string[] = accessor.split('.');
  for (let length: number = parts.length; length > 0; length -= 1) {
    const value: T | undefined = map.get(parts.slice(0, length).join('.'));
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}
