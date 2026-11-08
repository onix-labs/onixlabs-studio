import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InstalledPackage, PackageManagerModel } from '@shared/api/package-management';
import { NpmPackageManager } from './npm-package-manager';
import { fetchLatestVersion, latestFromMetadata } from './npm-registry';
import { endpointFor, readNpmConfig } from './npm-sources';
import type { HttpFetch, HttpResponse } from './package-manager';

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

  it('keepsAScopedNamesSlash_andSendsTheEndpointsHeaders', async () => {
    const urls: string[] = [];
    const fetchFn: HttpFetch = (url: string, init?: unknown): Promise<HttpResponse> => {
      urls.push(`${url} ${JSON.stringify(init)}`);
      return Promise.resolve(json({ 'dist-tags': { latest: '1.0.0' } }));
    };

    expect(await fetchLatestVersion('@scope/pkg', ENDPOINT, fetchFn)).toBe('1.0.0');

    expect(urls[0]).toContain('https://registry.example/@scope/pkg');
    expect(urls[0]).toContain('Bearer t');
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
