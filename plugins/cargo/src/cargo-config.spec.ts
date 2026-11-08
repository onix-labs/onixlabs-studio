import { describe, expect, it } from 'vitest';
import {
  CargoConfig,
  CargoRegistry,
  CRATES_IO_INDEX,
  EMPTY_CONFIG,
  readCargoConfig,
  readCredentials,
  resolveRegistries,
  sparseIndexUrl,
} from './cargo-config';
import { parseToml } from './toml';

/**
 * Reads a config from its lines.
 * @param lines The file's lines.
 * @returns Returns the config.
 */
function config(...lines: string[]): CargoConfig {
  return readCargoConfig(parseToml(lines.join('\n')));
}

/**
 * Finds a registry by name.
 * @param registries The registries.
 * @param name The name.
 * @returns Returns the registry.
 */
function named(registries: readonly CargoRegistry[], name: string): CargoRegistry | undefined {
  return registries.find((registry: CargoRegistry): boolean => registry.name === name);
}

describe('resolveRegistries', () => {
  it('resolveRegistries_nothingConfigured_isCratesIoAlone', () => {
    // Arrange
    const credentials: ReadonlyMap<string, string> = new Map<string, string>();

    // Act
    const registries: readonly CargoRegistry[] = resolveRegistries(
      EMPTY_CONFIG,
      EMPTY_CONFIG,
      credentials,
    );

    // Assert
    expect(registries).toEqual([
      { name: 'crates-io', index: CRATES_IO_INDEX, token: null, isPublic: true },
    ]);
  });

  it('resolveRegistries_userRegistryAndCredentials_bindsTheTokenToItsIndex', () => {
    // Arrange
    const user: CargoConfig = config(
      '[registries.corp]',
      'index = "sparse+https://corp.example/index/"',
    );
    const credentials: ReadonlyMap<string, string> = readCredentials(
      parseToml('[registry]\ntoken = "crates-io-token"\n[registries.corp]\ntoken = "corp-token"'),
    );

    // Act
    const corp: CargoRegistry | undefined = named(
      resolveRegistries(user, EMPTY_CONFIG, credentials),
      'corp',
    );

    // Assert
    expect(corp).toEqual({
      name: 'corp',
      index: 'https://corp.example/index/',
      token: 'corp-token',
      isPublic: false,
    });
  });

  it('resolveRegistries_projectRedirectsAUserRegistry_doesNotSendTheUserToken', () => {
    // Arrange
    const user: CargoConfig = config(
      '[registries.corp]',
      'index = "sparse+https://corp.example/index/"',
    );
    const project: CargoConfig = config(
      '[registries.corp]',
      'index = "sparse+https://attacker.example/index/"',
    );
    const credentials: ReadonlyMap<string, string> = new Map<string, string>([['corp', 'secret']]);

    // Act
    const corp: CargoRegistry | undefined = named(
      resolveRegistries(user, project, credentials),
      'corp',
    );

    // Assert
    expect(corp?.index).toBe('https://attacker.example/index/');
    expect(corp?.token).toBeNull();
  });

  it('resolveRegistries_registryOnlyTheProjectNames_getsNoUserToken', () => {
    // Arrange
    const project: CargoConfig = config(
      '[registries.corp]',
      'index = "sparse+https://corp.example/index/"',
    );
    const credentials: ReadonlyMap<string, string> = new Map<string, string>([['corp', 'secret']]);

    // Act
    const corp: CargoRegistry | undefined = named(
      resolveRegistries(EMPTY_CONFIG, project, credentials),
      'corp',
    );

    // Assert
    expect(corp?.token).toBeNull();
  });

  it('resolveRegistries_projectsOwnToken_goesWithItsOwnRegistry', () => {
    // Arrange
    const project: CargoConfig = config(
      '[registries.corp]',
      'index = "sparse+https://corp.example/index/"',
      'token = "project-token"',
    );

    // Act
    const corp: CargoRegistry | undefined = named(
      resolveRegistries(EMPTY_CONFIG, project, new Map<string, string>()),
      'corp',
    );

    // Assert
    expect(corp?.token).toBe('project-token');
  });

  it('resolveRegistries_gitIndex_hasNoIndexToRead', () => {
    // Arrange
    const user: CargoConfig = config('[registries.old]', 'index = "https://git.example/index.git"');

    // Act
    const old: CargoRegistry | undefined = named(
      resolveRegistries(user, EMPTY_CONFIG, new Map<string, string>()),
      'old',
    );

    // Assert
    expect(old?.index).toBeNull();
  });

  it('resolveRegistries_cratesIoReplacedByAMirror_readsTheMirror', () => {
    // Arrange
    const project: CargoConfig = config(
      '[source.crates-io]',
      'replace-with = "mirror"',
      '[source.mirror]',
      'registry = "sparse+https://mirror.example/"',
    );

    // Act
    const cratesIo: CargoRegistry | undefined = named(
      resolveRegistries(EMPTY_CONFIG, project, new Map<string, string>()),
      'crates-io',
    );

    // Assert
    expect(cratesIo).toEqual({
      name: 'crates-io',
      index: 'https://mirror.example/',
      token: null,
      isPublic: false,
    });
  });

  it('resolveRegistries_cratesIoVendored_hasNoIndex', () => {
    // Arrange
    const project: CargoConfig = config(
      '[source.crates-io]',
      'replace-with = "vendored"',
      '[source.vendored]',
      'directory = "vendor"',
    );

    // Act
    const cratesIo: CargoRegistry | undefined = named(
      resolveRegistries(EMPTY_CONFIG, project, new Map<string, string>()),
      'crates-io',
    );

    // Assert
    expect(cratesIo?.index).toBeNull();
    expect(cratesIo?.isPublic).toBe(false);
  });

  it('resolveRegistries_replacementCycle_stopsRatherThanLooping', () => {
    // Arrange
    const project: CargoConfig = config(
      '[source.crates-io]',
      'replace-with = "a"',
      '[source.a]',
      'replace-with = "b"',
      '[source.b]',
      'replace-with = "a"',
    );

    // Act
    const registries: readonly CargoRegistry[] = resolveRegistries(
      EMPTY_CONFIG,
      project,
      new Map<string, string>(),
    );

    // Assert
    expect(named(registries, 'crates-io')?.index).toBeNull();
  });
});

describe('sparseIndexUrl', () => {
  it('sparseIndexUrl_sparsePrefix_isStrippedAndEndsInASlash', () => {
    // Arrange
    const index: string = 'sparse+https://corp.example/index';

    // Act
    const url: string | null = sparseIndexUrl(index);

    // Assert
    expect(url).toBe('https://corp.example/index/');
  });

  it('sparseIndexUrl_otherSchemes_haveNone', () => {
    // Arrange
    const indexes: readonly string[] = ['sparse+file:///index/', 'sparse+not a url', 'git://x/y'];

    // Act
    const urls: readonly (string | null)[] = indexes.map(sparseIndexUrl);

    // Assert
    expect(urls).toEqual([null, null, null]);
  });
});
