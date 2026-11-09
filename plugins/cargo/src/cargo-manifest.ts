// Reads a `Cargo.toml` into what the Packages panel shows: the crate, the workspace it may define, and
// every dependency it declares, in every table cargo reads one from.

import { PackageDependencyScope } from './protocol';
import { arrayOf, stringOf, tableOf, TomlTable, TomlValue } from './toml';

/**
 * The tables a dependency can be declared in, each also possible under `[target.<cfg>]`.
 */
export type CargoDependencyTable = 'dependencies' | 'dev-dependencies' | 'build-dependencies';

/**
 * The dependency tables, in the order a crate's rows are listed and a write looks for a name.
 */
export const DEPENDENCY_TABLES: readonly CargoDependencyTable[] = [
  'dependencies',
  'dev-dependencies',
  'build-dependencies',
];

/**
 * Where a dependency comes from.
 */
export type CargoSource =
  | {
      /**
       * Discriminates a registry dependency.
       */
      readonly kind: 'registry';

      /**
       * Gets the alternative registry's name, or null for crates.io.
       */
      readonly registry: string | null;

      /**
       * Gets the version requirement.
       */
      readonly requirement: string;
    }
  | {
      /**
       * Discriminates a path dependency, which no registry knows a version of.
       */
      readonly kind: 'path';

      /**
       * Gets the path, as written.
       */
      readonly path: string;

      /**
       * Gets the version requirement written beside the path, if any.
       */
      readonly requirement: string | null;
    }
  | {
      /**
       * Discriminates a git dependency, which no registry knows a version of.
       */
      readonly kind: 'git';

      /**
       * Gets the repository URL, as written.
       */
      readonly url: string;

      /**
       * Gets the branch, tag or revision it follows, as `tag v1.2`, or null for the default branch.
       */
      readonly reference: string | null;

      /**
       * Gets the version requirement written beside the repository, if any.
       */
      readonly requirement: string | null;
    }
  | {
      /**
       * Discriminates `workspace = true` whose workspace entry could not be found.
       */
      readonly kind: 'workspace';
    };

/**
 * One dependency a crate declares.
 */
export interface CargoDependency {
  /**
   * Gets the name it is declared under, which is what `cargo add` and `cargo remove` take.
   */
  readonly key: string;

  /**
   * Gets the crate it names: the key, unless `package = "…"` renames it.
   */
  readonly package: string;

  /**
   * Gets the table it is declared in.
   */
  readonly table: CargoDependencyTable;

  /**
   * Gets the `[target.<this>]` it is declared under, or null for every target.
   */
  readonly target: string | null;

  /**
   * Gets whether it is `optional = true`, switched on by a feature.
   */
  readonly optional: boolean;

  /**
   * Gets whether it takes its source from the workspace (`workspace = true`).
   */
  readonly inherited: boolean;

  /**
   * Gets where it comes from.
   */
  readonly source: CargoSource;
}

/**
 * The `[workspace]` a manifest defines.
 */
export interface CargoWorkspace {
  /**
   * Gets the member paths and globs.
   */
  readonly members: readonly string[];

  /**
   * Gets the paths excluded from membership.
   */
  readonly exclude: readonly string[];

  /**
   * Gets `[workspace.dependencies]`, which members inherit with `workspace = true`, by key.
   */
  readonly dependencies: ReadonlyMap<string, CargoDependency>;
}

/**
 * A `Cargo.toml`, read.
 */
export interface CargoManifest {
  /**
   * Gets the crate's name, or null for a virtual manifest (a workspace with no crate of its own).
   */
  readonly name: string | null;

  /**
   * Gets the crate's version, or null when it declares none or inherits it.
   */
  readonly version: string | null;

  /**
   * Gets `package.workspace`, the path to the workspace root when it is not an ancestor, or null.
   */
  readonly workspacePath: string | null;

  /**
   * Gets the workspace it defines, or null.
   */
  readonly workspace: CargoWorkspace | null;

  /**
   * Gets every dependency it declares, inherited ones unresolved.
   */
  readonly dependencies: readonly CargoDependency[];
}

/**
 * Reads a parsed `Cargo.toml`.
 * @param document The parsed manifest.
 * @returns Returns the manifest.
 */
export function readManifest(document: TomlTable): CargoManifest {
  const pkg: TomlTable | null = tableOf(document['package']) ?? tableOf(document['project']);
  const dependencies: CargoDependency[] = [...readTables(document, null)];
  const targets: TomlTable = tableOf(document['target']) ?? {};
  for (const [target, section] of Object.entries(targets)) {
    const table: TomlTable | null = tableOf(section);
    if (table !== null) {
      dependencies.push(...readTables(table, target));
    }
  }
  return {
    name: stringOf(pkg?.['name']),
    version: stringOf(pkg?.['version']),
    workspacePath: stringOf(pkg?.['workspace']),
    workspace: readWorkspace(tableOf(document['workspace'])),
    dependencies,
  };
}

/**
 * Resolves an inherited dependency against its workspace's `[workspace.dependencies]`: it takes the
 * workspace entry's crate and source, and keeps its own table, target and optional flag. One the
 * workspace does not declare stays unresolved.
 * @param dependency The dependency.
 * @param workspace The workspace's dependencies, or null when the crate has no workspace.
 * @returns Returns the resolved dependency.
 */
export function resolveInherited(
  dependency: CargoDependency,
  workspace: ReadonlyMap<string, CargoDependency> | null,
): CargoDependency {
  if (dependency.source.kind !== 'workspace') {
    return dependency;
  }
  const entry: CargoDependency | undefined = workspace?.get(dependency.key);
  return entry === undefined
    ? dependency
    : { ...dependency, package: entry.package, source: entry.source };
}

/**
 * Maps a dependency onto the panel's scopes: dev- and build-dependencies are development, because
 * neither ships in what the crate builds; an optional dependency is optional; the rest are production.
 * @param dependency The dependency.
 * @returns Returns the scope.
 */
export function scopeOf(dependency: CargoDependency): PackageDependencyScope {
  if (dependency.table !== 'dependencies') {
    return 'development';
  }
  return dependency.optional ? 'optional' : 'production';
}

/**
 * Describes what a dependency asks for, as the panel's Requested column shows it: the version
 * requirement when there is one, otherwise where it comes from. ⛔ A git URL can carry a user and
 * token, and this goes to the renderer, so only its host and path are shown.
 * @param source Where the dependency comes from.
 * @returns Returns the description.
 */
export function describeRequested(source: CargoSource): string {
  switch (source.kind) {
    case 'registry':
      return source.requirement;
    case 'path':
      return source.requirement ?? `path ${source.path}`;
    case 'git':
      return (
        source.requirement ??
        `git ${safeUrl(source.url)}${source.reference === null ? '' : ` (${source.reference})`}`
      );
    case 'workspace':
      return 'workspace';
  }
}

/**
 * Reads a URL without its credentials, query or fragment, for showing.
 * @param url The URL.
 * @returns Returns its host and path, or a neutral word when it is not a URL.
 */
function safeUrl(url: string): string {
  try {
    const parsed: URL = new URL(url);
    return `${parsed.host}${parsed.pathname}`.replace(/\/+$/, '');
  } catch {
    return 'repository';
  }
}

/**
 * Reads the three dependency tables of a manifest or of one `[target.<cfg>]`.
 * @param section The manifest or target table.
 * @param target The target, or null for the manifest itself.
 * @returns Returns the dependencies.
 */
function readTables(section: TomlTable, target: string | null): readonly CargoDependency[] {
  const dependencies: CargoDependency[] = [];
  for (const table of DEPENDENCY_TABLES) {
    // `dev_dependencies` and `build_dependencies` are the old spellings cargo still reads.
    const entries: TomlTable | null =
      tableOf(section[table]) ?? tableOf(section[table.replace('-', '_')]);
    for (const [key, value] of Object.entries(entries ?? {})) {
      const dependency: CargoDependency | null = readDependency(key, value, table, target);
      if (dependency !== null) {
        dependencies.push(dependency);
      }
    }
  }
  return dependencies;
}

/**
 * Reads `[workspace]`.
 * @param section The table, or null when the manifest defines no workspace.
 * @returns Returns the workspace, or null.
 */
function readWorkspace(section: TomlTable | null): CargoWorkspace | null {
  if (section === null) {
    return null;
  }
  const strings: (value: TomlValue | undefined) => readonly string[] = (
    value: TomlValue | undefined,
  ): readonly string[] =>
    arrayOf(value).filter((entry: TomlValue): entry is string => typeof entry === 'string');
  const dependencies: Map<string, CargoDependency> = new Map<string, CargoDependency>();
  for (const [key, value] of Object.entries(tableOf(section['dependencies']) ?? {})) {
    const dependency: CargoDependency | null = readDependency(key, value, 'dependencies', null);
    if (dependency !== null) {
      dependencies.set(key, dependency);
    }
  }
  return {
    members: strings(section['members']),
    exclude: strings(section['exclude']),
    dependencies,
  };
}

/**
 * Reads one dependency: `name = "1.0"`, or a table with `version`, `path`, `git`, `registry`,
 * `package`, `optional` or `workspace = true`.
 * @param key The name it is declared under.
 * @param value What it is declared as.
 * @param table The table it is in.
 * @param target The target it is under, or null.
 * @returns Returns the dependency, or null when the entry is not one.
 */
function readDependency(
  key: string,
  value: TomlValue,
  table: CargoDependencyTable,
  target: string | null,
): CargoDependency | null {
  const base: Omit<CargoDependency, 'source' | 'package' | 'optional' | 'inherited'> = {
    key,
    table,
    target,
  };
  if (typeof value === 'string') {
    return {
      ...base,
      package: key,
      optional: false,
      inherited: false,
      source: { kind: 'registry', registry: null, requirement: value },
    };
  }
  const entry: TomlTable | null = tableOf(value);
  if (entry === null) {
    return null;
  }
  const optional: boolean = entry['optional'] === true;
  if (entry['workspace'] === true) {
    return { ...base, package: key, optional, inherited: true, source: { kind: 'workspace' } };
  }
  const requirement: string | null = stringOf(entry['version']);
  const path: string | null = stringOf(entry['path']);
  const git: string | null = stringOf(entry['git']);
  let source: CargoSource;
  if (path !== null) {
    source = { kind: 'path', path, requirement };
  } else if (git !== null) {
    source = { kind: 'git', url: git, reference: gitReference(entry), requirement };
  } else {
    source = {
      kind: 'registry',
      registry: stringOf(entry['registry']),
      requirement: requirement ?? '*',
    };
  }
  return {
    ...base,
    package: stringOf(entry['package']) ?? key,
    optional,
    inherited: false,
    source,
  };
}

/**
 * Reads which branch, tag or revision a git dependency follows.
 * @param entry The dependency's table.
 * @returns Returns it as `branch main`, `tag v1` or `rev abc123`, or null for the default branch.
 */
function gitReference(entry: TomlTable): string | null {
  for (const kind of ['branch', 'tag', 'rev']) {
    const reference: string | null = stringOf(entry[kind]);
    if (reference !== null) {
      return `${kind} ${reference}`;
    }
  }
  return null;
}
