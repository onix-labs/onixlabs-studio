import {
  parseCargoPackageName,
  parseCargoWorkspaceMembers,
  RustProjectSystem,
} from './rust-project-system';

describe('parseCargoPackageName', () => {
  it('readsThePackageTableName', () => {
    const toml: string = ['[package]', 'name = "my-crate"', 'version = "0.1.0"'].join('\n');
    expect(parseCargoPackageName(toml)).toBe('my-crate');
  });

  it('returnsNullForAVirtualWorkspaceRootWithNoPackage', () => {
    const toml: string = ['[workspace]', 'members = ["a", "b"]'].join('\n');
    expect(parseCargoPackageName(toml)).toBeNull();
    expect(parseCargoPackageName(null)).toBeNull();
  });

  it('doesNotReadANameFromAnotherTable', () => {
    const toml: string = ['[package]', 'version = "1"', '', '[dependencies]', 'name = "x"'].join(
      '\n',
    );
    expect(parseCargoPackageName(toml)).toBeNull();
  });
});

describe('parseCargoWorkspaceMembers', () => {
  it('readsAMultilineMembersArray', () => {
    const toml: string = [
      '[workspace]',
      'members = [',
      '  "crates/core",',
      '  "crates/cli",',
      ']',
    ].join('\n');
    expect(parseCargoWorkspaceMembers(toml)).toEqual(['crates/core', 'crates/cli']);
  });

  it('readsAnInlineMembersArrayWithWildcards', () => {
    expect(parseCargoWorkspaceMembers('[workspace]\nmembers = ["crates/*"]')).toEqual(['crates/*']);
  });

  it('returnsEmptyWhenAbsent', () => {
    expect(parseCargoWorkspaceMembers(null)).toEqual([]);
    expect(parseCargoWorkspaceMembers('[package]\nname = "x"')).toEqual([]);
  });
});

describe('RustProjectSystem', () => {
  const provider: RustProjectSystem = new RustProjectSystem();

  it('declaresTheRustKindWithDevReleaseAndATargetTripleAxis', () => {
    expect(provider.kind).toBe('rust');
    expect(provider.capabilities.actions).toEqual(['build', 'clean', 'rebuild']);
    expect(
      provider.capabilities.buildConfigurations.map((c: { id: string }): string => c.id),
    ).toEqual(['dev', 'release']);
    expect(provider.capabilities.target?.kind).toBe('target-triple');
    expect(provider.capabilities.debug).toBeNull();
  });

  it('ownsCargoManifestsOnly', () => {
    expect(provider.ownsProject('/w/Cargo.toml')).toBe(true);
    expect(provider.ownsProject('/w/Cargo.lock')).toBe(false);
    expect(provider.ownsProject('/w/main.rs')).toBe(false);
  });
});
