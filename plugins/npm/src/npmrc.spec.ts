import {
  mayCarryCredentials,
  mergeNpmrc,
  NpmEndpoint,
  NpmrcConfig,
  parseNpmrc,
  resolveNpmEndpoint,
} from './npmrc';

const FALLBACK: string = 'https://registry.npmjs.org';

describe('parseNpmrc', () => {
  it('reads the default registry, scoped registries, and interpolates ${ENV} tokens', () => {
    const text: string = [
      'registry=https://registry.npmjs.org/',
      '@acme:registry=https://npm.pkg.github.com',
      '//npm.pkg.github.com/:_authToken=${GH_TOKEN}',
      '# a comment',
      '',
    ].join('\n');
    const config: NpmrcConfig = parseNpmrc(text, { GH_TOKEN: 'secret-123' });
    expect(config.registry).toBe('https://registry.npmjs.org');
    expect(config.scopedRegistries['@acme']).toBe('https://npm.pkg.github.com');
    expect(config.auth).toEqual([{ prefix: '//npm.pkg.github.com/', token: 'secret-123' }]);
  });
});

describe('resolveNpmEndpoint', () => {
  const config: NpmrcConfig = parseNpmrc(
    ['@acme:registry=https://npm.pkg.github.com', '//npm.pkg.github.com/:_authToken=tok'].join(
      '\n',
    ),
    {},
  );

  it('routes a scoped package to its registry with the bearer token', () => {
    expect(resolveNpmEndpoint(config, '@acme/widget', FALLBACK)).toEqual({
      registry: 'https://npm.pkg.github.com',
      headers: { Authorization: 'Bearer tok' },
    });
  });

  it('routes an unscoped package to the fallback registry with no auth', () => {
    expect(resolveNpmEndpoint(config, 'lodash', FALLBACK)).toEqual({
      registry: FALLBACK,
      headers: {},
    });
  });
});

describe('mergeNpmrc', () => {
  it('lets the override win on registry and scopes, and tries its auth first', () => {
    const base: NpmrcConfig = parseNpmrc('registry=https://base/\n//base/:_authToken=b', {});
    const override: NpmrcConfig = parseNpmrc('registry=https://override/', {});
    const merged: NpmrcConfig = mergeNpmrc(base, override);
    expect(merged.registry).toBe('https://override');
    expect(merged.auth).toEqual([{ prefix: '//base/', token: 'b' }]);
  });
});

describe('mayCarryCredentials', () => {
  it('mayCarryCredentials_httpsRegistry_returnsTrue', () => {
    // Arrange
    const registry: string = 'https://npm.pkg.github.com';

    // Act
    const result: boolean = mayCarryCredentials(registry);

    // Assert
    expect(result).toBe(true);
  });

  it('mayCarryCredentials_plainHttpRemoteRegistry_returnsFalse', () => {
    // Arrange
    const registry: string = 'http://npm.pkg.github.com';

    // Act
    const result: boolean = mayCarryCredentials(registry);

    // Assert
    expect(result).toBe(false);
  });

  it('mayCarryCredentials_plainHttpLoopbackRegistry_returnsTrue', () => {
    // Arrange
    const registries: readonly string[] = [
      'http://localhost:4873',
      'http://127.0.0.1:4873/',
      'http://[::1]:4873',
    ];

    // Act
    const results: readonly boolean[] = registries.map((registry: string): boolean =>
      mayCarryCredentials(registry),
    );

    // Assert
    expect(results).toEqual([true, true, true]);
  });

  it('mayCarryCredentials_notAUrl_returnsFalse', () => {
    // Arrange
    const registry: string = 'npm.pkg.github.com';

    // Act
    const result: boolean = mayCarryCredentials(registry);

    // Assert
    expect(result).toBe(false);
  });
});

describe('resolveNpmEndpoint over plain http', () => {
  it('resolveNpmEndpoint_plainHttpRegistryMatchingAToken_sendsNoAuthorization', () => {
    // Arrange
    const config: NpmrcConfig = parseNpmrc(
      ['registry=http://npm.pkg.github.com', '//npm.pkg.github.com/:_authToken=tok'].join('\n'),
      {},
    );

    // Act
    const endpoint: NpmEndpoint = resolveNpmEndpoint(config, 'widget', FALLBACK);

    // Assert
    expect(endpoint).toEqual({ registry: 'http://npm.pkg.github.com', headers: {} });
  });

  it('resolveNpmEndpoint_plainHttpLoopbackRegistry_sendsTheToken', () => {
    // Arrange
    const config: NpmrcConfig = parseNpmrc(
      ['registry=http://127.0.0.1:4873/', '//127.0.0.1:4873/:_authToken=tok'].join('\n'),
      {},
    );

    // Act
    const endpoint: NpmEndpoint = resolveNpmEndpoint(config, 'widget', FALLBACK);

    // Assert
    expect(endpoint.headers).toEqual({ Authorization: 'Bearer tok' });
  });
});
