import { PackageDependencyScope } from '@shared/api/package-management';

/**
 * Pure parsers for the NuGet manifest and restore formats: SDK-style `PackageReference` items in a
 * project file, `PackageVersion` items in a `Directory.Packages.props` (Central Package Management),
 * legacy `packages.config`, and the resolved versions in `packages.lock.json` / `project.assets.json`.
 * Kept free of Node imports so the parsing is unit-testable; the package manager pairs them with the
 * filesystem. The XML is scanned with regular expressions rather than a full parser: the shapes are
 * simple and well-formed, and this avoids a dependency for a read-only view.
 */

/**
 * A declared NuGet dependency read from a project file: its id, the version it declares (null when the
 * version is supplied centrally and not yet resolved), and its scope.
 */
export interface NuGetReference {
  /**
   * Gets the package id.
   */
  readonly id: string;

  /**
   * Gets the declared version, or null when the project defers to Central Package Management.
   */
  readonly version: string | null;

  /**
   * Gets the dependency scope.
   */
  readonly scope: PackageDependencyScope;
}

/**
 * Reads a double-quoted XML attribute from a tag's attribute text, case-insensitively on the name.
 * @param attributes The attribute text.
 * @param name The attribute name.
 * @returns Returns the value, or null when the attribute is absent.
 */
function attribute(attributes: string, name: string): string | null {
  const match: RegExpExecArray | null = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i').exec(
    attributes,
  );
  return match === null ? null : match[1];
}

/**
 * Reads a nested `<Version>` child element from a tag's inner body (the child-element form of a
 * `PackageReference`), or null when absent.
 * @param body The element body between the open and close tags.
 * @returns Returns the version, or null.
 */
function childVersion(body: string): string | null {
  const match: RegExpExecArray | null = /<Version>\s*([^<\s][^<]*?)\s*<\/Version>/i.exec(body);
  return match === null ? null : match[1].trim();
}

/**
 * Parses the `PackageReference` items from a project file's XML. Handles both the attribute form
 * (`<PackageReference Include="Id" Version="x" />`) and the child-element form
 * (`<PackageReference Include="Id"><Version>x</Version></PackageReference>`), reads `VersionOverride`
 * in preference to `Version`, and marks a reference with `PrivateAssets="all"` as a development
 * dependency (the convention for analyzers and build-only tooling). A reference with no version is
 * emitted with a null version, to be resolved from Central Package Management.
 * @param xml The project file content.
 * @returns Returns the declared references.
 */
export function parsePackageReferences(xml: string): readonly NuGetReference[] {
  const references: NuGetReference[] = [];
  // Match a self-closing tag or an open/close pair (capturing the body for the child-element version).
  const pattern: RegExp = /<PackageReference\b([^>]*?)(?:\/>|>([\s\S]*?)<\/PackageReference>)/gi;
  for (const match of xml.matchAll(pattern)) {
    const attributes: string = match[1];
    const body: string = match[2] ?? '';
    const id: string | null = attribute(attributes, 'Include') ?? attribute(attributes, 'Update');
    if (id === null || id.length === 0) {
      continue;
    }
    const version: string | null =
      attribute(attributes, 'VersionOverride') ??
      attribute(attributes, 'Version') ??
      childVersion(body);
    const privateAssets: string | null = attribute(attributes, 'PrivateAssets');
    const scope: PackageDependencyScope =
      privateAssets?.toLowerCase().includes('all') === true ? 'development' : 'production';
    references.push({ id, version, scope });
  }
  return references;
}

/**
 * Parses the `PackageVersion` items from a `Directory.Packages.props` into a case-insensitive map of
 * id to version, the central versions a project's version-less `PackageReference`s resolve against.
 * @param xml The props file content.
 * @returns Returns the central versions, keyed by lower-cased id.
 */
export function parsePackageVersions(xml: string): ReadonlyMap<string, string> {
  const versions: Map<string, string> = new Map<string, string>();
  const pattern: RegExp = /<PackageVersion\b([^>]*?)(?:\/>|>[\s\S]*?<\/PackageVersion>)/gi;
  for (const match of xml.matchAll(pattern)) {
    const attributes: string = match[1];
    const id: string | null = attribute(attributes, 'Include');
    const version: string | null = attribute(attributes, 'Version');
    if (id !== null && id.length > 0 && version !== null) {
      versions.set(id.toLowerCase(), version);
    }
  }
  return versions;
}

/**
 * Parses a legacy `packages.config` into its declared references (all production scope; the old format
 * has no scope axis). Entries flagged `developmentDependency="true"` are marked development.
 * @param xml The packages.config content.
 * @returns Returns the declared references.
 */
export function parsePackagesConfig(xml: string): readonly NuGetReference[] {
  const references: NuGetReference[] = [];
  for (const match of xml.matchAll(/<package\b([^>]*?)\/?>/gi)) {
    const attributes: string = match[1];
    const id: string | null = attribute(attributes, 'id');
    const version: string | null = attribute(attributes, 'version');
    if (id === null || id.length === 0) {
      continue;
    }
    const development: boolean =
      attribute(attributes, 'developmentDependency')?.toLowerCase() === 'true';
    references.push({ id, version, scope: development ? 'development' : 'production' });
  }
  return references;
}

/**
 * Reads the resolved versions from a parsed `packages.lock.json` into a case-insensitive id-to-version
 * map, across every target framework, taking the highest resolved version when a package appears under
 * more than one framework.
 * @param lock The parsed lockfile.
 * @param compare A version comparator, so the highest resolved version wins.
 * @returns Returns the resolved versions, keyed by lower-cased id.
 */
export function parseLockInstalled(
  lock: unknown,
  compare: (a: string, b: string) => number,
): ReadonlyMap<string, string> {
  const versions: Map<string, string> = new Map<string, string>();
  if (typeof lock !== 'object' || lock === null) {
    return versions;
  }
  const dependencies: unknown = (lock as { dependencies?: unknown }).dependencies;
  if (typeof dependencies !== 'object' || dependencies === null) {
    return versions;
  }
  for (const framework of Object.values(dependencies as Record<string, unknown>)) {
    if (typeof framework !== 'object' || framework === null) {
      continue;
    }
    for (const [id, entry] of Object.entries(framework as Record<string, unknown>)) {
      const resolved: unknown = (entry as { resolved?: unknown }).resolved;
      if (typeof resolved === 'string' && resolved.length > 0) {
        keepHighest(versions, id, resolved, compare);
      }
    }
  }
  return versions;
}

/**
 * Reads the resolved versions from a parsed `project.assets.json` into a case-insensitive id-to-version
 * map, from its `libraries` keys (`Id/Version`) of package type, taking the highest version when a
 * package appears at more than one version.
 * @param assets The parsed assets file.
 * @param compare A version comparator, so the highest resolved version wins.
 * @returns Returns the resolved versions, keyed by lower-cased id.
 */
export function parseAssetsInstalled(
  assets: unknown,
  compare: (a: string, b: string) => number,
): ReadonlyMap<string, string> {
  const versions: Map<string, string> = new Map<string, string>();
  if (typeof assets !== 'object' || assets === null) {
    return versions;
  }
  const libraries: unknown = (assets as { libraries?: unknown }).libraries;
  if (typeof libraries !== 'object' || libraries === null) {
    return versions;
  }
  for (const [key, value] of Object.entries(libraries as Record<string, unknown>)) {
    const type: unknown = (value as { type?: unknown }).type;
    const separator: number = key.indexOf('/');
    if (type !== 'package' || separator === -1) {
      continue;
    }
    const id: string = key.slice(0, separator);
    const version: string = key.slice(separator + 1);
    if (id.length > 0 && version.length > 0) {
      keepHighest(versions, id, version, compare);
    }
  }
  return versions;
}

/**
 * Records a resolved version for an id (lower-cased), keeping the higher of an existing and a new
 * version so a package restored at several versions reports its newest.
 * @param versions The map being built.
 * @param id The package id.
 * @param version The resolved version.
 * @param compare The version comparator.
 */
function keepHighest(
  versions: Map<string, string>,
  id: string,
  version: string,
  compare: (a: string, b: string) => number,
): void {
  const key: string = id.toLowerCase();
  const existing: string | undefined = versions.get(key);
  if (existing === undefined || compare(version, existing) > 0) {
    versions.set(key, version);
  }
}
