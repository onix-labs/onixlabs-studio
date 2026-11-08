import { describe, expect, it } from 'vitest';
import {
  Conanfile,
  ConanReference,
  isExactVersion,
  parseConanfilePy,
  parseConanfileTxt,
  parseLock,
  parseReference,
} from './conanfile';
import { compareVersions } from './versions';

describe('parseReference', () => {
  it('parseReference_everyPart_isReadToNameAndVersion', () => {
    // Arrange
    const texts: readonly string[] = [
      'fmt/10.2.1',
      'zlib/1.3.1@_/_',
      'boost/1.84.0@me/stable#abc123%1700000000.1',
      'openssl/[>=3 <4]',
    ];

    // Act
    const references: readonly (ConanReference | null)[] = texts.map(parseReference);

    // Assert
    expect(references).toEqual([
      { name: 'fmt', version: '10.2.1' },
      { name: 'zlib', version: '1.3.1' },
      { name: 'boost', version: '1.84.0' },
      { name: 'openssl', version: '[>=3 <4]' },
    ]);
  });

  it('parseReference_notAReference_isNull', () => {
    // Arrange
    const texts: readonly string[] = ['fmt', 'CMakeDeps', '/1.0', 'a b/1.0'];

    // Act
    const references: readonly (ConanReference | null)[] = texts.map(parseReference);

    // Assert
    expect(references).toEqual([null, null, null, null]);
  });

  it('isExactVersion_aRange_isNot', () => {
    // Arrange
    const range: string = '[>=1.2 <2]';

    // Act
    const exact: boolean = isExactVersion(range);

    // Assert
    expect(exact).toBe(false);
    expect(isExactVersion('1.2.0')).toBe(true);
  });
});

describe('parseConanfileTxt', () => {
  it('parseConanfileTxt_requirementSections_mapOntoScopes', () => {
    // Arrange
    const text: string = [
      '# a comment',
      '[requires]',
      'fmt/10.2.1',
      'zlib/[>=1.2 <2]',
      '',
      '[tool_requires]',
      'cmake/3.27.0',
      '[build_requires]',
      'ninja/1.11.1',
      '[test_requires]',
      'gtest/1.14.0',
      '[generators]',
      'CMakeDeps',
      '[options]',
      'fmt/*:shared=True',
    ].join('\r\n');

    // Act
    const conanfile: Conanfile = parseConanfileTxt(text);

    // Assert
    expect(conanfile).toEqual({
      name: null,
      requirements: [
        { name: 'fmt', version: '10.2.1', scope: 'production' },
        { name: 'zlib', version: '[>=1.2 <2]', scope: 'production' },
        { name: 'cmake', version: '3.27.0', scope: 'development' },
        { name: 'ninja', version: '1.11.1', scope: 'development' },
        { name: 'gtest', version: '1.14.0', scope: 'development' },
      ],
    });
  });
});

describe('parseConanfilePy', () => {
  it('parseConanfilePy_attributesAndCalls_areReadWithoutRunningIt', () => {
    // Arrange
    const text: string = [
      'from conan import ConanFile',
      '',
      'class App(ConanFile):',
      '    name = "app"',
      '    requires = "fmt/10.2.1", "zlib/[>=1.2 <2]"',
      '    tool_requires = [',
      '        "cmake/3.27.0",  # the build tool',
      '        "ninja/1.11.1",',
      '    ]',
      '    # requires = "commented/1.0"',
      '',
      '    def requirements(self):',
      '        self.requires("boost/1.84.0", transitive_headers=True)',
      "        self.test_requires('gtest/1.14.0')",
      '        self.requires(f"spdlog/{self.version}")',
      '        if self.options.with_ssl:',
      '            self.requires(self._ssl_ref)',
    ].join('\n');

    // Act
    const conanfile: Conanfile = parseConanfilePy(text);

    // Assert
    expect(conanfile).toEqual({
      name: 'app',
      requirements: [
        { name: 'fmt', version: '10.2.1', scope: 'production' },
        { name: 'zlib', version: '[>=1.2 <2]', scope: 'production' },
        { name: 'cmake', version: '3.27.0', scope: 'development' },
        { name: 'ninja', version: '1.11.1', scope: 'development' },
        { name: 'boost', version: '1.84.0', scope: 'production' },
        { name: 'gtest', version: '1.14.0', scope: 'development' },
      ],
    });
  });

  it('parseConanfilePy_noRequirements_isEmpty', () => {
    // Arrange
    const text: string = 'class App(ConanFile):\n    settings = "os", "arch"\n';

    // Act
    const conanfile: Conanfile = parseConanfilePy(text);

    // Assert
    expect(conanfile).toEqual({ name: null, requirements: [] });
  });
});

describe('parseLock', () => {
  it('parseLock_aConan2Lock_givesTheLockedVersions', () => {
    // Arrange
    const lock: unknown = {
      version: '0.5',
      requires: ['zlib/1.3.1#f52e03ae3d251dec704634230cd806a2%1708593606.497', 'fmt/10.2.1#abc'],
      build_requires: ['cmake/3.28.1#def%1.0'],
      python_requires: [],
    };

    // Act
    const locked: ReadonlyMap<string, string> = parseLock(lock, compareVersions);

    // Assert
    expect([...locked]).toEqual([
      ['zlib', '1.3.1'],
      ['fmt', '10.2.1'],
      ['cmake', '3.28.1'],
    ]);
  });

  it('parseLock_notALock_isEmpty', () => {
    // Arrange
    const lock: unknown = 'nonsense';

    // Act
    const locked: ReadonlyMap<string, string> = parseLock(lock, compareVersions);

    // Assert
    expect(locked.size).toBe(0);
  });
});
