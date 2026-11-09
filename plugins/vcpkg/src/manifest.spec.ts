import { describe, expect, it } from 'vitest';
import { parseManifest, sourceOf, VcpkgManifest } from './manifest';

/**
 * A baseline sha, as a manifest pins one.
 */
const SHA: string = 'a'.repeat(40);

/**
 * Another baseline sha.
 */
const OTHER_SHA: string = 'b'.repeat(40);

describe('parseManifest', () => {
  it('parseManifest_bothDependencyForms_areRead', () => {
    // Arrange
    const manifest: unknown = {
      name: 'app',
      dependencies: [
        'fmt',
        { name: 'zlib', 'version>=': '1.3.1', features: ['x'], platform: '!windows' },
        { name: 'protobuf', host: true },
        { features: ['no-name'] },
        42,
      ],
    };

    // Act
    const parsed: VcpkgManifest | null = parseManifest(manifest, null);

    // Assert
    expect(parsed?.name).toBe('app');
    expect(parsed?.dependencies).toEqual([
      { name: 'fmt', host: false, minimum: null },
      { name: 'zlib', host: false, minimum: '1.3.1' },
      { name: 'protobuf', host: true, minimum: null },
    ]);
  });

  it('parseManifest_overrides_readEveryVersionSchemeWithPortVersion', () => {
    // Arrange
    const manifest: unknown = {
      dependencies: [],
      overrides: [
        { name: 'fmt', version: '10.1.1' },
        { name: 'zlib', version: '1.2.13', 'port-version': 2 },
        { name: 'icu', 'version-date': '2024-01-01' },
        { name: 'broken' },
      ],
    };

    // Act
    const parsed: VcpkgManifest | null = parseManifest(manifest, null);

    // Assert
    expect([...(parsed?.overrides ?? [])]).toEqual([
      ['fmt', '10.1.1'],
      ['zlib', '1.2.13#2'],
      ['icu', '2024-01-01'],
    ]);
  });

  it('parseManifest_noConfiguration_defaultsToTheBuiltinRegistryAtTheBuiltinBaseline', () => {
    // Arrange
    const manifest: unknown = { 'builtin-baseline': SHA.toUpperCase(), dependencies: ['fmt'] };

    // Act
    const parsed: VcpkgManifest | null = parseManifest(manifest, null);

    // Assert
    expect(parsed?.defaultSource).toEqual({ kind: 'builtin', baseline: SHA });
  });

  it('parseManifest_baselineNotASha_isNotTrusted', () => {
    // Arrange
    const manifest: unknown = { 'builtin-baseline': '../../evil', dependencies: [] };

    // Act
    const parsed: VcpkgManifest | null = parseManifest(manifest, null);

    // Assert
    expect(parsed?.defaultSource).toEqual({ kind: 'builtin', baseline: null });
  });

  it('parseManifest_notAnObject_isNull', () => {
    // Arrange
    const manifest: unknown = ['fmt'];

    // Act
    const parsed: VcpkgManifest | null = parseManifest(manifest, null);

    // Assert
    expect(parsed).toBeNull();
  });
});

describe('sourceOf', () => {
  it('sourceOf_registriesInTheConfigurationFile_followVcpkgsRule', () => {
    // Arrange
    const configuration: unknown = {
      'default-registry': {
        kind: 'git',
        repository: 'https://github.com/microsoft/vcpkg',
        baseline: OTHER_SHA,
      },
      registries: [
        {
          kind: 'git',
          repository: 'https://example.com/ports.git',
          baseline: SHA,
          packages: ['beicode', 'boost-*'],
        },
        { kind: 'filesystem', path: './ports', packages: ['boost-asio'] },
        { kind: 'artifact', name: 'tools', location: 'https://example.com/a.zip' },
      ],
    };
    const parsed: VcpkgManifest | null = parseManifest({ dependencies: [] }, configuration);

    // Act
    const sources: readonly unknown[] = ['beicode', 'boost-json', 'boost-asio', 'fmt'].map(
      (port: string): unknown => (parsed === null ? null : sourceOf(parsed, port)),
    );

    // Assert
    expect(sources).toEqual([
      { kind: 'other' },
      { kind: 'other' },
      { kind: 'other' },
      { kind: 'builtin', baseline: OTHER_SHA },
    ]);
  });

  it('sourceOf_longestPrefixWins', () => {
    // Arrange
    const configuration: unknown = {
      registries: [
        { kind: 'builtin', baseline: SHA, packages: ['boost-*'] },
        { kind: 'git', repository: 'https://example.com/x.git', packages: ['boost-a*'] },
      ],
    };
    const parsed: VcpkgManifest | null = parseManifest({ dependencies: [] }, configuration);

    // Act
    const asio: unknown = parsed === null ? null : sourceOf(parsed, 'boost-asio');
    const json: unknown = parsed === null ? null : sourceOf(parsed, 'boost-json');

    // Assert
    expect(asio).toEqual({ kind: 'other' });
    expect(json).toEqual({ kind: 'builtin', baseline: SHA });
  });

  it('sourceOf_embeddedConfigurationWithNullDefault_hasNoReadableSource', () => {
    // Arrange
    const manifest: unknown = {
      'builtin-baseline': SHA,
      dependencies: ['fmt'],
      'vcpkg-configuration': { 'default-registry': null },
    };
    const parsed: VcpkgManifest | null = parseManifest(manifest, null);

    // Act
    const source: unknown = parsed === null ? null : sourceOf(parsed, 'fmt');

    // Assert
    expect(source).toEqual({ kind: 'other' });
  });
});
