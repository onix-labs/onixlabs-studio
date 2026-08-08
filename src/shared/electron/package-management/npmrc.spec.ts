import { mergeNpmrc, NpmrcConfig, parseNpmrc, resolveNpmEndpoint } from './npmrc';

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
    expect(config.auth).toEqual([
      { prefix: '//npm.pkg.github.com/', token: 'secret-123' },
    ]);
  });
});

describe('resolveNpmEndpoint', () => {
  const config: NpmrcConfig = parseNpmrc(
    [
      '@acme:registry=https://npm.pkg.github.com',
      '//npm.pkg.github.com/:_authToken=tok',
    ].join('\n'),
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
