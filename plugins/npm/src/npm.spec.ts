import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  HttpFetch,
  HttpResponse,
  InstalledPackage,
  PackageManagerModel,
  PackageSearchResult,
  PackageSourceInfo,
} from './protocol';
import { NpmPackageManager } from './npm';
import { fetchLatestVersion, latestFromMetadata } from './npm-registry';
import { endpointFor, readNpmConfig } from './npm-sources';

/**
 * Builds a response.
 * @param body The JSON body.
 * @param ok Whether it succeeded.
 * @returns Returns the response.
 */
function json(body: unknown, ok: boolean = true): HttpResponse {
  return { ok, status: ok ? 200 : 500, json: (): Promise<unknown> => Promise.resolve(body) };
}

describe('latestFromMetadata', () => {
  it.each<[string, unknown]>([
    ['null', null],
    ['aString', 'x'],
    ['noDistTags', {}],
    ['distTagsOfTheWrongType', { 'dist-tags': 'latest' }],
    ['noLatest', { 'dist-tags': { next: '2.0.0' } }],
    ['aNonStringLatest', { 'dist-tags': { latest: 1 } }],
    ['anEmptyLatest', { 'dist-tags': { latest: '' } }],
  ])('readsNothingFrom_%s', (_name: string, body: unknown) => {
    expect(latestFromMetadata(body)).toBeNull();
  });

  it('readsTheLatestTag', () => {
    expect(latestFromMetadata({ 'dist-tags': { latest: '1.2.3' } })).toBe('1.2.3');
  });
});

describe('fetchLatestVersion', () => {
  const ENDPOINT: { registry: string; headers: Record<string, string> } = {
    registry: 'https://registry.example',
    headers: { authorization: 'Bearer t' },
  };

  it('addressesAScopedNameAsTheCliDoes_andSendsTheEndpointsHeaders', async () => {
    const urls: string[] = [];
    const fetchFn: HttpFetch = (url: string, init?: unknown): Promise<HttpResponse> => {
      urls.push(`${url} ${JSON.stringify(init)}`);
      return Promise.resolve(json({ 'dist-tags': { latest: '1.0.0' } }));
    };

    expect(await fetchLatestVersion('@scope/pkg', ENDPOINT, fetchFn)).toBe('1.0.0');

    expect(urls[0]).toContain('https://registry.example/@scope%2Fpkg ');
    expect(urls[0]).toContain('Bearer t');
  });

  it.each<[string, string]>([
    ['../../-/whoami', 'https://registry.example/..%2F..%2F-%2Fwhoami'],
    ['@scope/../../x', 'https://registry.example/@scope%2F..%2F..%2Fx'],
    ['a@b', 'https://registry.example/a%40b'],
  ])('neverLetsTheName_%s_addPathSegments', async (name: string, expected: string) => {
    const urls: string[] = [];
    const fetchFn: HttpFetch = (url: string): Promise<HttpResponse> => {
      urls.push(url);
      return Promise.resolve(json({ 'dist-tags': { latest: '1.0.0' } }));
    };

    await fetchLatestVersion(name, ENDPOINT, fetchFn);

    expect(urls).toEqual([expected]);
    expect(new URL(urls[0]).pathname.split('/')).toHaveLength(2);
  });

  it.each<[string, HttpFetch]>([
    ['aFailedStatus', (): Promise<HttpResponse> => Promise.resolve(json({}, false))],
    ['aNetworkFailure', (): Promise<HttpResponse> => Promise.reject(new Error('ETIMEDOUT'))],
    [
      'aBodyThatIsNotJson',
      (): Promise<HttpResponse> =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: (): Promise<unknown> => Promise.reject(new SyntaxError('<html>')),
        }),
    ],
  ])('isNull_for_%s', async (_name: string, fetchFn: HttpFetch) => {
    expect(await fetchLatestVersion('pkg', ENDPOINT, fetchFn)).toBeNull();
  });
});

describe('npm packages on disk', () => {
  let root: string = '';
  let home: string = '';
  const manager: NpmPackageManager = new NpmPackageManager();

  /**
   * Writes files in the workspace.
   * @param files The files' contents, by relative path.
   */
  function write(files: Readonly<Record<string, string>>): void {
    for (const [name, content] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
      writeFileSync(path.join(root, name), content);
    }
  }

  /**
   * A registry that knows every package at one version.
   * @param calls Receives each URL.
   * @returns Returns the fetch.
   */
  function registry(calls: string[] = []): HttpFetch {
    return (url: string): Promise<HttpResponse> => {
      calls.push(url);
      return Promise.resolve(json({ 'dist-tags': { latest: '2.0.0' } }));
    };
  }

  /**
   * Finds a package in the root project of a model.
   * @param model The model.
   * @param name The package.
   * @returns Returns it.
   */
  function find(model: PackageManagerModel | null, name: string): InstalledPackage | undefined {
    return model?.projects[0].packages.find(
      (entry: InstalledPackage): boolean => entry.name === name,
    );
  }

  beforeEach(() => {
    root = realpathSync(mkdtempSync(path.join(tmpdir(), 'studio-npm-')));
    // The user's own `.npmrc` holds their tokens, and has no place in a spec.
    home = realpathSync(mkdtempSync(path.join(tmpdir(), 'studio-npm-home-')));
    vi.stubEnv('HOME', home);
    vi.stubEnv('USERPROFILE', home);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  });

  it('detectsAReadableManifest_only', async () => {
    expect(await manager.detect(root)).toBe(false);

    write({ 'package.json': '{' });
    expect(await manager.detect(root)).toBe(false);

    write({ 'package.json': '{}' });
    expect(await manager.detect(root)).toBe(true);
  });

  it('isNull_withNoReadableManifest', async () => {
    expect(await manager.load(root, registry())).toBeNull();
  });

  it('readsEverySection_withItsScopeAndStatus', async () => {
    write({
      'package.json': JSON.stringify({
        dependencies: { a: '^1.0.0' },
        devDependencies: { b: '^1.0.0' },
        peerDependencies: { c: '*' },
        optionalDependencies: { d: '*', e: 5 },
      }),
      'package-lock.json': JSON.stringify({
        packages: {
          '': { name: 'root' },
          'node_modules/a': { version: '1.0.0' },
          'node_modules/x/node_modules/b': { version: '2.0.0' },
        },
      }),
    });

    const model: PackageManagerModel | null = await manager.load(root, registry());

    expect(find(model, 'a')).toMatchObject({
      scope: 'production',
      requested: '^1.0.0',
      installed: '1.0.0',
      latest: '2.0.0',
    });
    expect(find(model, 'b')).toMatchObject({ scope: 'development', installed: '2.0.0' });
    expect(find(model, 'c')?.scope).toBe('peer');
    expect(find(model, 'd')).toMatchObject({ scope: 'optional', installed: null });
    expect(find(model, 'e')).toBeUndefined();
  });

  it('readsAnOldLockfile_withoutOverridingANewerEntry', async () => {
    write({
      'package.json': '{"dependencies":{"a":"*","b":"*"}}',
      'package-lock.json': JSON.stringify({
        packages: { 'node_modules/a': { version: '3.0.0' } },
        dependencies: { a: { version: '1.0.0' }, b: { version: '1.5.0' } },
      }),
    });

    const model: PackageManagerModel | null = await manager.load(root, registry());

    expect(find(model, 'a')?.installed).toBe('3.0.0');
    expect(find(model, 'b')?.installed).toBe('1.5.0');
  });

  it.each<[string, string]>([
    ['aNullEntry', '{"packages":{"node_modules/a":null},"dependencies":{"a":null}}'],
    ['aStringEntry', '{"packages":{"node_modules/a":"x"}}'],
    ['packagesOfTheWrongType', '{"packages":3,"dependencies":"x"}'],
    ['truncatedJson', '{"packages":'],
  ])('survivesALockfileWith_%s', async (_name: string, lock: string) => {
    write({ 'package.json': '{"dependencies":{"a":"*"}}', 'package-lock.json': lock });

    const model: PackageManagerModel | null = await manager.load(root, registry());

    expect(find(model, 'a')?.installed).toBeNull();
  });

  it('readsAManifestWithAByteOrderMark', async () => {
    write({ 'package.json': '﻿{"dependencies":{"a":"*"}}' });

    expect(find(await manager.load(root, registry()), 'a')).toBeDefined();
  });

  it('asksTheRegistryOncePerPackage_acrossWorkspaces', async () => {
    write({
      'package.json': '{"workspaces":["packages/*","solo","gone/*"],"dependencies":{"a":"*"}}',
      'packages/one/package.json': '{"name":"one","dependencies":{"a":"*","b":"*"}}',
      'packages/two/package.json': 'not json',
      'packages/file.txt': '',
      'solo/package.json': '{"dependencies":{"b":"*"}}',
    });
    const calls: string[] = [];

    const model: PackageManagerModel | null = await manager.load(root, registry(calls));

    expect(model?.projects.map((project: { name: string }): string => project.name)).toEqual([
      path.basename(root),
      'one',
      'solo',
    ]);
    expect(calls).toHaveLength(2);
  });

  it('stillLoads_whenTheRegistryIsDown', async () => {
    write({ 'package.json': '{"dependencies":{"a":"*"}}' });

    const model: PackageManagerModel | null = await manager.load(root, (): Promise<HttpResponse> =>
      Promise.reject(new Error('ENOTFOUND')),
    );

    expect(find(model, 'a')).toMatchObject({ latest: null });
  });

  it('neverAsksMoreThanItsLimitAtOnce', async () => {
    const dependencies: Record<string, string> = {};
    for (let index: number = 0; index < 30; index += 1) {
      dependencies[`p${index}`] = '*';
    }
    write({ 'package.json': JSON.stringify({ dependencies }) });
    let open: number = 0;
    let peak: number = 0;

    await manager.load(root, async (): Promise<HttpResponse> => {
      open += 1;
      peak = Math.max(peak, open);
      await Promise.resolve();
      open -= 1;
      return json({});
    });

    expect(peak).toBeLessThanOrEqual(8);
    expect(peak).toBeGreaterThan(1);
  });

  describe('other lockfiles', () => {
    it('readsInstalledVersionsFromPnpm', async () => {
      write({
        'package.json': '{"dependencies":{"a":"*"}}',
        'pnpm-lock.yaml': 'packages:\n\n  a@1.2.3:\n    resolution: {}\n',
      });

      expect(find(await manager.load(root, registry()), 'a')?.installed).toBe('1.2.3');
    });

    it('readsInstalledVersionsFromYarn', async () => {
      write({
        'package.json': '{"dependencies":{"a":"*"}}',
        'yarn.lock': 'a@*:\n  version "1.2.3"\n',
      });

      expect(find(await manager.load(root, registry()), 'a')?.installed).toBe('1.2.3');
    });

    it('prefersNpmsOwnLockfile', async () => {
      write({
        'package.json': '{"dependencies":{"a":"*"}}',
        'package-lock.json': '{"packages":{"node_modules/a":{"version":"3.0.0"}}}',
        'yarn.lock': 'a@*:\n  version "1.2.3"\n',
      });

      expect(find(await manager.load(root, registry()), 'a')?.installed).toBe('3.0.0');
    });
  });

  describe('credentials', () => {
    /**
     * Writes an `.npmrc` routing a scope to a private registry.
     * @param token The token line's value, or null for none.
     */
    function privateRegistry(token: string | null): void {
      write({
        'package.json': '{"dependencies":{"@acme/a":"*"}}',
        '.npmrc': [
          '@acme:registry=https://acme.example/',
          ...(token === null ? [] : [`//acme.example/:_authToken=${token}`]),
        ].join('\n'),
      });
    }

    /**
     * A registry that records the headers of every request.
     * @param seen Receives each request's URL and headers.
     * @returns Returns the fetch.
     */
    function recording(seen: { url: string; headers: Record<string, string> }[]): HttpFetch {
      return (url: string, init?: { headers?: Record<string, string> }): Promise<HttpResponse> => {
        seen.push({ url, headers: init?.headers ?? {} });
        return Promise.resolve(json({ 'dist-tags': { latest: '2.0.0' } }));
      };
    }

    it('sendsTheTokenTheConfigurationHolds_withoutAskingStudio', async () => {
      privateRegistry('from-npmrc');
      const asked: string[] = [];
      const seen: { url: string; headers: Record<string, string> }[] = [];
      const withStudio: NpmPackageManager = new NpmPackageManager((registry: string) => {
        asked.push(registry);
        return Promise.resolve('from-studio');
      });

      await withStudio.load(root, recording(seen));

      expect(seen[0].headers['Authorization']).toBe('Bearer from-npmrc');
      expect(asked).toEqual([]);
    });

    it('asksStudioOnly_whenTheConfigurationHoldsNoToken', async () => {
      privateRegistry(null);
      const asked: string[] = [];
      const seen: { url: string; headers: Record<string, string> }[] = [];
      const withStudio: NpmPackageManager = new NpmPackageManager((registry: string) => {
        asked.push(registry);
        return Promise.resolve('from-studio');
      });

      await withStudio.load(root, recording(seen));

      expect(asked).toEqual(['https://acme.example']);
      expect(seen[0].headers['Authorization']).toBe('Bearer from-studio');
    });

    it('neverAsksStudioAboutThePublicRegistry', async () => {
      write({ 'package.json': '{"dependencies":{"a":"*"}}' });
      const asked: string[] = [];
      const withStudio: NpmPackageManager = new NpmPackageManager((registry: string) => {
        asked.push(registry);
        return Promise.resolve('from-studio');
      });

      await withStudio.load(root, registry());

      expect(asked).toEqual([]);
    });

    it('sendsNoHeader_whenAReferenceResolvesToNothing', async () => {
      privateRegistry('${NPM_TOKEN}');
      const seen: { url: string; headers: Record<string, string> }[] = [];

      await manager.load(root, recording(seen));

      expect(seen[0].headers['Authorization']).toBeUndefined();
    });

    it('resolvesAReferenceFromTheEnvironmentItWasGiven', async () => {
      privateRegistry(null);
      writeFileSync(path.join(home, '.npmrc'), '//acme.example/:_authToken=${NPM_TOKEN}\n');
      const seen: { url: string; headers: Record<string, string> }[] = [];
      const withEnvironment: NpmPackageManager = new NpmPackageManager(undefined, {
        NPM_TOKEN: 'from-environment',
      });

      await withEnvironment.load(root, recording(seen));

      expect(seen[0].headers['Authorization']).toBe('Bearer from-environment');
    });

    it('load_projectNpmrcReferencesAnEnvironmentVariable_sendsNoHeader', async () => {
      // Arrange
      privateRegistry('${NPM_TOKEN}');
      const seen: { url: string; headers: Record<string, string> }[] = [];
      const withEnvironment: NpmPackageManager = new NpmPackageManager(undefined, {
        NPM_TOKEN: 'from-environment',
      });

      // Act
      await withEnvironment.load(root, recording(seen));

      // Assert
      expect(JSON.stringify(seen)).not.toContain('from-environment');
    });

    it('load_plainHttpRegistry_neverAsksStudioForAToken', async () => {
      // Arrange
      write({
        'package.json': '{"dependencies":{"@acme/a":"*"}}',
        '.npmrc': '@acme:registry=http://acme.example/\n',
      });
      const asked: string[] = [];
      const seen: { url: string; headers: Record<string, string> }[] = [];
      const withStudio: NpmPackageManager = new NpmPackageManager((registry: string) => {
        asked.push(registry);
        return Promise.resolve('from-studio');
      });

      // Act
      await withStudio.load(root, recording(seen));

      // Assert
      expect(asked).toEqual([]);
      expect(seen[0].headers['Authorization']).toBeUndefined();
    });

    it('keepsAnotherHostsTokenOffAScopedRequest', async () => {
      write({
        'package.json': '{"dependencies":{"@acme/a":"*"}}',
        '.npmrc': [
          '@acme:registry=https://acme.example/',
          '//elsewhere.example/:_authToken=other-host',
        ].join('\n'),
      });
      const seen: { url: string; headers: Record<string, string> }[] = [];

      await manager.load(root, recording(seen));

      expect(JSON.stringify(seen)).not.toContain('other-host');
    });
  });

  describe('sources and search', () => {
    /**
     * A registry answering a search with one page of two packages.
     * @param calls Receives each URL.
     * @returns Returns the fetch.
     */
    function searching(calls: string[] = []): HttpFetch {
      return (url: string): Promise<HttpResponse> => {
        calls.push(url);
        return Promise.resolve(
          json({
            total: 3,
            objects: [
              {
                package: { name: 'left-pad', version: '1.3.0', description: 'pads' },
                downloads: { monthly: 1200, weekly: 300 },
              },
              { package: { name: 'right-pad', version: '1.0.0' } },
              { package: {} },
            ],
          }),
        );
      };
    }

    it('namesThePublicRegistryNpm', async () => {
      await expect(manager.listSources(root)).resolves.toEqual([{ name: 'npm' }]);
    });

    it('namesAPrivateDefaultAfterItsHost_andEachScope', async () => {
      write({
        '.npmrc': [
          'registry=https://user:secret@registry.example:8443/npm/',
          '@acme:registry=https://acme.example/',
          '//acme.example/:_authToken=secret-token',
        ].join('\n'),
      });

      const sources: readonly PackageSourceInfo[] = await manager.listSources(root);

      expect(sources).toEqual([
        { name: 'registry.example:8443' },
        { name: '@acme (acme.example)' },
      ]);
      expect(JSON.stringify(sources)).not.toContain('secret');
    });

    it('asksThePublicRegistryForAPage', async () => {
      const calls: string[] = [];

      await manager.search(
        root,
        'npm',
        'left pad',
        { skip: 20, take: 10, prerelease: false },
        searching(calls),
      );

      expect(calls).toEqual([
        'https://registry.npmjs.org/-/v1/search?text=left+pad&size=10&from=20',
      ]);
    });

    it('readsNameVersionDescriptionAndMonthlyDownloads', async () => {
      const result: PackageSearchResult = await manager.search(
        root,
        'npm',
        'pad',
        { skip: 0, take: 2, prerelease: false },
        searching(),
      );

      expect(result.items).toEqual([
        {
          name: 'left-pad',
          version: '1.3.0',
          description: 'pads',
          downloads: 1200,
          verified: false,
          sourceName: 'npm',
        },
        {
          name: 'right-pad',
          version: '1.0.0',
          description: '',
          downloads: null,
          verified: false,
          sourceName: 'npm',
        },
      ]);
      expect(result.total).toBe(3);
    });

    it('saysThereIsMore_untilThePagesReachTheTotal', async () => {
      const first: PackageSearchResult = await manager.search(
        root,
        'npm',
        'pad',
        { skip: 0, take: 3, prerelease: false },
        (): Promise<HttpResponse> =>
          Promise.resolve(
            json({ total: 4, objects: [{ package: { name: 'a' } }, { package: { name: 'b' } }] }),
          ),
      );
      const last: PackageSearchResult = await manager.search(
        root,
        'npm',
        'pad',
        { skip: 2, take: 3, prerelease: false },
        (): Promise<HttpResponse> =>
          Promise.resolve(
            json({ total: 4, objects: [{ package: { name: 'c' } }, { package: { name: 'd' } }] }),
          ),
      );

      expect(first.hasMore).toBe(true);
      expect(last.hasMore).toBe(false);
    });

    it('carriesTheScopedRegistrysCredential', async () => {
      write({
        '.npmrc': [
          '@acme:registry=https://acme.example/',
          '//acme.example/:_authToken=scoped-token',
        ].join('\n'),
      });
      const seen: string[] = [];

      await manager.search(
        root,
        '@acme (acme.example)',
        'x',
        { skip: 0, take: 10, prerelease: false },
        (url: string, init?: { headers?: Record<string, string> }): Promise<HttpResponse> => {
          seen.push(`${url} ${init?.headers?.['Authorization']}`);
          return Promise.resolve(json({ total: 0, objects: [] }));
        },
      );

      expect(seen).toEqual([
        'https://acme.example/-/v1/search?text=x&size=10&from=0 Bearer scoped-token',
      ]);
    });

    it.each<[string, HttpFetch]>([
      ['aFailedStatus', (): Promise<HttpResponse> => Promise.resolve(json({}, false))],
      ['aNetworkFailure', (): Promise<HttpResponse> => Promise.reject(new Error('ETIMEDOUT'))],
      ['aBodyOfTheWrongShape', (): Promise<HttpResponse> => Promise.resolve(json('nope'))],
    ])('answersAnEmptyPage_for_%s', async (_name: string, fetchFn: HttpFetch) => {
      await expect(
        manager.search(root, 'npm', 'x', { skip: 0, take: 10, prerelease: false }, fetchFn),
      ).resolves.toEqual({ items: [], total: 0, hasMore: false });
    });

    it('answersAnEmptyPage_forASourceTheFolderDoesNotHave', async () => {
      const calls: string[] = [];

      await expect(
        manager.search(
          root,
          'elsewhere',
          'x',
          { skip: 0, take: 10, prerelease: false },
          searching(calls),
        ),
      ).resolves.toEqual({ items: [], total: 0, hasMore: false });
      expect(calls).toEqual([]);
    });
  });

  describe('npmrc', () => {
    it('layersTheProjectOverTheUser_andRoutesAScopeToItsRegistry', async () => {
      writeFileSync(path.join(home, '.npmrc'), 'registry=https://user.example/\n');
      write({ '.npmrc': '@acme:registry=https://acme.example/\n' });

      const config: Awaited<ReturnType<typeof readNpmConfig>> = await readNpmConfig(root, {});

      expect(endpointFor(config, '@acme/x').registry).toMatch(/acme\.example/);
      expect(endpointFor(config, 'plain').registry).toMatch(/user\.example/);
    });

    it('fallsBackToThePublicRegistry_whenThereIsNoConfiguration', async () => {
      expect(readdirSync(home)).toEqual([]);

      const config: Awaited<ReturnType<typeof readNpmConfig>> = await readNpmConfig(root, {});

      expect(endpointFor(config, 'x').registry).toBe('https://registry.npmjs.org');
    });

    it('readNpmConfig_projectNpmrcReferencesAnEnvironmentVariable_sendsNoCredential', async () => {
      // Arrange
      write({
        '.npmrc': 'registry=https://evil.example/\n//evil.example/:_authToken=${SECRET}\n',
      });

      // Act
      const config: Awaited<ReturnType<typeof readNpmConfig>> = await readNpmConfig(root, {
        SECRET: 'leaked',
      });

      // Assert
      expect(endpointFor(config, 'x')).toEqual({ registry: 'https://evil.example', headers: {} });
    });

    it('readNpmConfig_userNpmrcReferencesAnEnvironmentVariable_interpolatesIt', async () => {
      // Arrange
      writeFileSync(
        path.join(home, '.npmrc'),
        'registry=https://user.example/\n//user.example/:_authToken=${NPM_TOKEN}\n',
      );

      // Act
      const config: Awaited<ReturnType<typeof readNpmConfig>> = await readNpmConfig(root, {
        NPM_TOKEN: 'user-token',
      });

      // Assert
      expect(endpointFor(config, 'x').headers).toEqual({ Authorization: 'Bearer user-token' });
    });

    it('readNpmConfig_projectNpmrcHasALiteralToken_sendsIt', async () => {
      // Arrange
      write({ '.npmrc': 'registry=https://acme.example/\n//acme.example/:_authToken=literal\n' });

      // Act
      const config: Awaited<ReturnType<typeof readNpmConfig>> = await readNpmConfig(root, {});

      // Assert
      expect(endpointFor(config, 'x').headers).toEqual({ Authorization: 'Bearer literal' });
    });
  });
});
