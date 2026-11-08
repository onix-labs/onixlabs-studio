// Reads a vcpkg manifest (`vcpkg.json`) and its registry configuration (`vcpkg-configuration.json`, or
// the same object embedded in the manifest under `vcpkg-configuration`).
//
// Only what the Packages panel shows is read: the dependencies, the overrides that pin a version, the
// `builtin-baseline` that decides the version of everything else, and which registry each port comes
// from. Anything malformed is skipped rather than failing the whole manifest, because vcpkg will say
// what is wrong with it far better than a viewer can.

import { formatVersion } from './versions';

/**
 * The version fields a manifest's override can carry, one per versioning scheme.
 */
const VERSION_FIELDS: readonly string[] = [
  'version',
  'version-semver',
  'version-date',
  'version-string',
];

/**
 * Matches a vcpkg baseline: a full Git commit sha, the only form vcpkg accepts. Checked before one goes
 * into a URL.
 */
const BASELINE: RegExp = /^[0-9a-f]{40}$/i;

/**
 * Matches the GitHub repository of vcpkg's own registry, which a `git` registry often names: it is the
 * built-in registry by another route, and is read the same way.
 */
const BUILTIN_REPOSITORY: RegExp =
  /^(?:https:\/\/|git@)github\.com[/:]microsoft\/vcpkg(?:\.git)?\/?$/i;

/**
 * One dependency a manifest declares.
 */
export interface VcpkgDependency {
  /**
   * Gets the port name.
   */
  readonly name: string;

  /**
   * Gets whether it is a host dependency: a tool built for the machine doing the build, such as a code
   * generator, rather than a library linked into the project.
   */
  readonly host: boolean;

  /**
   * Gets the minimum version the manifest asks for (`version>=`), or null when it asks for none.
   */
  readonly minimum: string | null;
}

/**
 * Where a port's versions come from.
 */
export type VcpkgPortSource =
  /**
   * vcpkg's built-in registry, at the given baseline, or with no baseline when the manifest sets none
   * (vcpkg then uses whatever ports tree it was run from, which nothing here can see).
   */
  | { readonly kind: 'builtin'; readonly baseline: string | null }

  /**
   * Another registry: a Git repository, a folder or nothing at all. Its versions are not read.
   */
  | { readonly kind: 'other' };

/**
 * One registry from the configuration.
 */
interface VcpkgRegistry {
  /**
   * Gets where its ports come from.
   */
  readonly source: VcpkgPortSource;

  /**
   * Gets the port-name patterns it serves: exact names, or a prefix ending in `*`.
   */
  readonly packages: readonly string[];
}

/**
 * A manifest, as far as the panel needs it.
 */
export interface VcpkgManifest {
  /**
   * Gets the manifest's own name, or null when it has none.
   */
  readonly name: string | null;

  /**
   * Gets the dependencies, in the order declared.
   */
  readonly dependencies: readonly VcpkgDependency[];

  /**
   * Gets the overridden versions by port name, written as vcpkg writes them (`1.3.1#3`).
   */
  readonly overrides: ReadonlyMap<string, string>;

  /**
   * Gets where a port not served by a named registry comes from.
   */
  readonly defaultSource: VcpkgPortSource;

  /**
   * Gets the named registries.
   */
  readonly registries: readonly VcpkgRegistry[];
}

/**
 * Reads a value as a JSON object.
 * @param value The candidate.
 * @returns Returns the object, or null when it is not one.
 */
function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Reads a field as a non-empty string.
 * @param record The object.
 * @param key The field.
 * @returns Returns the string, or null when it is not one.
 */
function stringField(record: Record<string, unknown>, key: string): string | null {
  const value: unknown = record[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Reads a baseline, refusing anything that is not a commit sha.
 * @param value The candidate.
 * @returns Returns the baseline in lower case, or null.
 */
function baselineOf(value: unknown): string | null {
  return typeof value === 'string' && BASELINE.test(value) ? value.toLowerCase() : null;
}

/**
 * Reads one dependency, in either of its forms: a bare port name, or an object with `name` and the
 * optional `host`, `version>=`, `features` and `platform`.
 * @param entry The entry.
 * @returns Returns the dependency, or null when it names no port.
 */
function readDependency(entry: unknown): VcpkgDependency | null {
  if (typeof entry === 'string') {
    return entry.length > 0 ? { name: entry, host: false, minimum: null } : null;
  }
  const record: Record<string, unknown> | null = asObject(entry);
  const name: string | null = record === null ? null : stringField(record, 'name');
  if (record === null || name === null) {
    return null;
  }
  return { name, host: record['host'] === true, minimum: stringField(record, 'version>=') };
}

/**
 * Reads the overrides: each pins one port to one version, whatever the baseline says.
 * @param value The `overrides` array.
 * @returns Returns the versions by port name.
 */
function readOverrides(value: unknown): ReadonlyMap<string, string> {
  const overrides: Map<string, string> = new Map<string, string>();
  for (const entry of Array.isArray(value) ? value : []) {
    const record: Record<string, unknown> | null = asObject(entry);
    const name: string | null = record === null ? null : stringField(record, 'name');
    if (record === null || name === null) {
      continue;
    }
    const version: string | undefined = VERSION_FIELDS.map((field: string): string | null =>
      stringField(record, field),
    ).find((candidate: string | null): candidate is string => candidate !== null);
    if (version === undefined) {
      continue;
    }
    const port: unknown = record['port-version'];
    overrides.set(name, formatVersion(version, typeof port === 'number' ? port : 0));
  }
  return overrides;
}

/**
 * Reads where one registry's ports come from. The built-in registry, or a Git registry that is the
 * built-in one's own repository, is read at its baseline; anything else is not read at all.
 * @param registry The registry object.
 * @param builtinBaseline The manifest's `builtin-baseline`, which a `builtin` registry with no
 * baseline of its own falls back to.
 * @returns Returns the source.
 */
function readSource(
  registry: Record<string, unknown>,
  builtinBaseline: string | null,
): VcpkgPortSource {
  const kind: unknown = registry['kind'];
  if (kind === 'builtin') {
    return { kind: 'builtin', baseline: baselineOf(registry['baseline']) ?? builtinBaseline };
  }
  const repository: string | null = stringField(registry, 'repository');
  if (kind === 'git' && repository !== null && BUILTIN_REPOSITORY.test(repository)) {
    return { kind: 'builtin', baseline: baselineOf(registry['baseline']) };
  }
  return { kind: 'other' };
}

/**
 * Parses a manifest and its configuration.
 * @param manifest The parsed `vcpkg.json`.
 * @param configuration The parsed `vcpkg-configuration.json`, or null when there is none (the
 * manifest's embedded `vcpkg-configuration` is used then).
 * @returns Returns the manifest, or null when the file is not a JSON object.
 */
export function parseManifest(manifest: unknown, configuration: unknown): VcpkgManifest | null {
  const record: Record<string, unknown> | null = asObject(manifest);
  if (record === null) {
    return null;
  }
  const builtinBaseline: string | null = baselineOf(record['builtin-baseline']);
  const dependencies: VcpkgDependency[] = [];
  for (const entry of Array.isArray(record['dependencies']) ? record['dependencies'] : []) {
    const dependency: VcpkgDependency | null = readDependency(entry);
    if (dependency !== null) {
      dependencies.push(dependency);
    }
  }
  const config: Record<string, unknown> | null =
    asObject(configuration) ?? asObject(record['vcpkg-configuration']);

  // With no `default-registry` the built-in registry serves everything at `builtin-baseline`. One set
  // to null means there is no default registry at all, so a port no named registry serves cannot be
  // found, and nothing here pretends otherwise.
  let defaultSource: VcpkgPortSource = { kind: 'builtin', baseline: builtinBaseline };
  if (config !== null && 'default-registry' in config) {
    const registry: Record<string, unknown> | null = asObject(config['default-registry']);
    defaultSource = registry === null ? { kind: 'other' } : readSource(registry, builtinBaseline);
  }

  const registries: VcpkgRegistry[] = [];
  const listed: unknown = config?.['registries'];
  for (const entry of Array.isArray(listed) ? listed : []) {
    const registry: Record<string, unknown> | null = asObject(entry);
    // An `artifact` registry serves tools to `vcpkg activate`, not ports, so it never decides a port.
    if (registry === null || registry['kind'] === 'artifact') {
      continue;
    }
    const packages: readonly string[] = (
      Array.isArray(registry['packages']) ? registry['packages'] : []
    ).filter((pattern: unknown): pattern is string => typeof pattern === 'string');
    registries.push({ source: readSource(registry, builtinBaseline), packages });
  }

  return {
    name: stringField(record, 'name'),
    dependencies,
    overrides: readOverrides(record['overrides']),
    defaultSource,
    registries,
  };
}

/**
 * Finds which registry serves a port, by vcpkg's rule: a registry naming the port exactly wins, then
 * the one with the longest matching `prefix*` pattern, and the default registry otherwise.
 * @param manifest The manifest.
 * @param port The port name.
 * @returns Returns where the port's versions come from.
 */
export function sourceOf(manifest: VcpkgManifest, port: string): VcpkgPortSource {
  let best: VcpkgPortSource | null = null;
  let bestLength: number = -1;
  for (const registry of manifest.registries) {
    for (const pattern of registry.packages) {
      if (pattern === port) {
        return registry.source;
      }
      const prefix: string = pattern.slice(0, -1);
      if (pattern.endsWith('*') && port.startsWith(prefix) && prefix.length > bestLength) {
        best = registry.source;
        bestLength = prefix.length;
      }
    }
  }
  return best ?? manifest.defaultSource;
}
