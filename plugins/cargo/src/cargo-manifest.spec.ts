import { describe, expect, it } from 'vitest';
import {
  CargoDependency,
  CargoManifest,
  describeRequested,
  readManifest,
  resolveInherited,
  scopeOf,
} from './cargo-manifest';
import { parseToml } from './toml';

/**
 * Reads a manifest from its text.
 * @param lines The manifest's lines.
 * @returns Returns the manifest.
 */
function manifest(...lines: string[]): CargoManifest {
  return readManifest(parseToml(lines.join('\n')));
}

/**
 * Finds a dependency by key and table.
 * @param read The manifest.
 * @param key The key.
 * @param table The table.
 * @returns Returns the dependency.
 */
function find(read: CargoManifest, key: string, table: string = 'dependencies'): CargoDependency {
  const found: CargoDependency | undefined = read.dependencies.find(
    (dependency: CargoDependency): boolean => dependency.key === key && dependency.table === table,
  );
  if (found === undefined) {
    throw new Error(`no ${key} in ${table}`);
  }
  return found;
}

describe('readManifest', () => {
  it('readManifest_everyTable_readsEachDependencyWithItsTable', () => {
    // Arrange
    const read: CargoManifest = manifest(
      '[package]',
      'name = "app"',
      'version = "0.1.0"',
      '[dependencies]',
      'serde = "1.0"',
      '[dev-dependencies]',
      'proptest = { version = "1.4" }',
      '[build-dependencies.cc]',
      'version = "1.0.83"',
    );

    // Act
    const keys: readonly string[] = read.dependencies.map(
      (dependency: CargoDependency): string => `${dependency.table}:${dependency.key}`,
    );

    // Assert
    expect(read.name).toBe('app');
    expect(read.version).toBe('0.1.0');
    expect(keys).toEqual([
      'dependencies:serde',
      'dev-dependencies:proptest',
      'build-dependencies:cc',
    ]);
    expect(find(read, 'cc', 'build-dependencies').source).toEqual({
      kind: 'registry',
      registry: null,
      requirement: '1.0.83',
    });
  });

  it('readManifest_targetTables_carryTheirTarget', () => {
    // Arrange
    const read: CargoManifest = manifest(
      '[package]',
      'name = "app"',
      "[target.'cfg(windows)'.dependencies]",
      'windows-sys = "0.52"',
      "[target.'cfg(unix)'.dev-dependencies]",
      'nix = "0.28"',
    );

    // Act
    const windows: CargoDependency = find(read, 'windows-sys');
    const nix: CargoDependency = find(read, 'nix', 'dev-dependencies');

    // Assert
    expect(windows.target).toBe('cfg(windows)');
    expect(nix.target).toBe('cfg(unix)');
  });

  it('readManifest_pathGitRegistryAndRename_readTheirSources', () => {
    // Arrange
    const read: CargoManifest = manifest(
      '[package]',
      'name = "app"',
      '[dependencies]',
      'local = { path = "../local" }',
      'pinned = { path = "../pinned", version = "0.2" }',
      'forked = { git = "https://user:secret@github.com/me/forked.git", tag = "v1.2" }',
      'internal = { version = "2", registry = "corp" }',
      'json = { package = "serde_json", version = "1", optional = true }',
    );

    // Act
    const internal: CargoDependency = find(read, 'internal');
    const json: CargoDependency = find(read, 'json');

    // Assert
    expect(find(read, 'local').source).toEqual({
      kind: 'path',
      path: '../local',
      requirement: null,
    });
    expect(describeRequested(find(read, 'pinned').source)).toBe('0.2');
    expect(find(read, 'forked').source).toMatchObject({ kind: 'git', reference: 'tag v1.2' });
    expect(internal.source).toEqual({ kind: 'registry', registry: 'corp', requirement: '2' });
    expect(json.package).toBe('serde_json');
    expect(json.optional).toBe(true);
  });

  it('readManifest_workspace_readsMembersExcludeAndDependencies', () => {
    // Arrange
    const read: CargoManifest = manifest(
      '[workspace]',
      'members = ["crates/*"]',
      'exclude = ["crates/legacy"]',
      '[workspace.dependencies]',
      'tokio = { version = "1.37", features = ["full"] }',
    );

    // Act
    const tokio: CargoDependency | undefined = read.workspace?.dependencies.get('tokio');

    // Assert
    expect(read.name).toBeNull();
    expect(read.workspace?.members).toEqual(['crates/*']);
    expect(read.workspace?.exclude).toEqual(['crates/legacy']);
    expect(tokio?.source).toEqual({ kind: 'registry', registry: null, requirement: '1.37' });
  });

  it('readManifest_oldUnderscoreTableNames_areStillRead', () => {
    // Arrange
    const read: CargoManifest = manifest(
      '[package]',
      'name = "app"',
      '[dev_dependencies]',
      'a = "1"',
    );

    // Act
    const dependency: CargoDependency = find(read, 'a', 'dev-dependencies');

    // Assert
    expect(dependency.key).toBe('a');
  });
});

describe('resolveInherited', () => {
  it('resolveInherited_workspaceTrue_takesTheWorkspaceSourceAndKeepsItsOwnTable', () => {
    // Arrange
    const workspace: CargoManifest = manifest(
      '[workspace]',
      '[workspace.dependencies]',
      'json = { package = "serde_json", version = "1.0.117" }',
    );
    const member: CargoManifest = manifest(
      '[package]',
      'name = "member"',
      '[dev-dependencies]',
      'json.workspace = true',
    );

    // Act
    const resolved: CargoDependency = resolveInherited(
      member.dependencies[0],
      workspace.workspace?.dependencies ?? null,
    );

    // Assert
    expect(resolved).toMatchObject({
      key: 'json',
      package: 'serde_json',
      table: 'dev-dependencies',
      inherited: true,
      source: { kind: 'registry', requirement: '1.0.117' },
    });
  });

  it('resolveInherited_missingFromTheWorkspace_staysUnresolved', () => {
    // Arrange
    const member: CargoManifest = manifest(
      '[package]',
      'name = "member"',
      '[dependencies]',
      'serde = { workspace = true }',
    );

    // Act
    const resolved: CargoDependency = resolveInherited(member.dependencies[0], null);

    // Assert
    expect(resolved.source).toEqual({ kind: 'workspace' });
    expect(describeRequested(resolved.source)).toBe('workspace');
  });
});

describe('scopeOf', () => {
  it('scopeOf_eachTable_mapsOntoThePanelsScopes', () => {
    // Arrange
    const read: CargoManifest = manifest(
      '[package]',
      'name = "app"',
      '[dependencies]',
      'a = "1"',
      'b = { version = "1", optional = true }',
      '[dev-dependencies]',
      'c = "1"',
      '[build-dependencies]',
      'd = "1"',
    );

    // Act
    const scopes: readonly string[] = read.dependencies.map(scopeOf);

    // Assert
    expect(scopes).toEqual(['production', 'optional', 'development', 'development']);
  });
});

describe('describeRequested', () => {
  it('describeRequested_gitWithCredentials_showsOnlyTheHostAndPath', () => {
    // Arrange
    const read: CargoManifest = manifest(
      '[package]',
      'name = "app"',
      '[dependencies]',
      'forked = { git = "https://user:secret@github.com/me/forked.git?x=1", branch = "main" }',
    );

    // Act
    const requested: string = describeRequested(read.dependencies[0].source);

    // Assert
    expect(requested).toBe('git github.com/me/forked.git (branch main)');
    expect(requested).not.toContain('secret');
  });

  it('describeRequested_pathWithoutVersion_saysPath', () => {
    // Arrange
    const read: CargoManifest = manifest(
      '[package]',
      'name = "app"',
      '[dependencies]',
      'local = { path = "../local" }',
    );

    // Act
    const requested: string = describeRequested(read.dependencies[0].source);

    // Assert
    expect(requested).toBe('path ../local');
  });
});
