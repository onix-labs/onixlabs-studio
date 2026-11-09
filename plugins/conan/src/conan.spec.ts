import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConanPackageManager } from './conan';
import type { HttpFetch, HttpResponse, PackageManagerModel, PackageSearchResult } from './protocol';

/**
 * One request the fake remote saw.
 */
interface Seen {
  /**
   * Gets the URL.
   */
  readonly url: string;

  /**
   * Gets the `Authorization` header, if any.
   */
  readonly authorization: string | undefined;
}

/**
 * The recipe versions the fake remotes hold, by remote host.
 */
const RECIPES: Record<string, readonly string[]> = {
  'conan.example.com': ['internal/2.0.0@_/_', 'internal/2.1.0@_/_'],
  'center2.conan.io': [
    'fmt/10.2.1@_/_',
    'fmt/12.2.0@_/_',
    'fmt/13.0.0-rc1@_/_',
    'fmtlog/2.3.0@_/_',
    'zlib/1.3.1@_/_',
    'zlib/1.3.2@_/_',
    'gtest/1.14.0@_/_',
    'libfmt/1.0@_/_',
  ],
};

/**
 * Builds fake remotes over {@link RECIPES} that answer the v2 search like ConanCenter does.
 * @param seen Where the requests are recorded.
 * @returns Returns the fetch.
 */
function fakeRemotes(seen: Seen[]): HttpFetch {
  return (url: string, init?: { headers?: Record<string, string> }): Promise<HttpResponse> => {
    seen.push({ url, authorization: init?.headers?.['Authorization'] });
    const parsed: URL = new URL(url);
    const pattern: string = parsed.searchParams.get('q') ?? '';
    const matcher: RegExp = new RegExp(`^${pattern.replaceAll('.', '\\.').replaceAll('*', '.*')}$`);
    const results: readonly string[] = (RECIPES[parsed.hostname] ?? []).filter(
      (reference: string): boolean => matcher.test(reference.split('/')[0]),
    );
    return Promise.resolve({
      ok: true,
      status: 200,
      json: (): Promise<unknown> => Promise.resolve({ results }),
    });
  };
}

describe('ConanPackageManager', () => {
  let scratch: string = '';
  let root: string = '';
  let home: string = '';
  let seen: Seen[] = [];
  let asks: string[] = [];
  let manager: ConanPackageManager;

  beforeEach(() => {
    scratch = realpathSync(mkdtempSync(path.join(tmpdir(), 'studio-conan-')));
    root = path.join(scratch, 'workspace');
    home = path.join(scratch, 'home');
    mkdirSync(root);
    mkdirSync(path.join(home, '.conan2'), { recursive: true });
    seen = [];
    asks = [];
    manager = new ConanPackageManager(
      fakeRemotes(seen),
      (registry: string): Promise<string | null> => {
        asks.push(registry);
        return Promise.resolve('studio-token');
      },
      { HOME: home },
    );
  });

  afterEach(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  it('load_aFolderWithNoConanfile_isNull', async () => {
    // Arrange
    writeFileSync(path.join(root, 'CMakeLists.txt'), 'project(x)');

    // Act
    const model: PackageManagerModel | null = await manager.load(root);

    // Assert
    expect(model).toBeNull();
    expect(seen).toEqual([]);
  });

  it('load_aConanfileTxtWithALock_resolvesLockedThenExactVersions', async () => {
    // Arrange
    writeFileSync(
      path.join(root, 'conanfile.txt'),
      '[requires]\nfmt/10.2.1\nzlib/[>=1.2 <2]\nmissing/[*]\n[test_requires]\ngtest/1.14.0\n',
    );
    writeFileSync(
      path.join(root, 'conan.lock'),
      JSON.stringify({ version: '0.5', requires: ['zlib/1.3.1#abc%1.0'], build_requires: [] }),
    );

    // Act
    const model: PackageManagerModel | null = await manager.load(root);

    // Assert
    expect(model).toEqual({
      ecosystem: 'conan',
      root,
      projects: [
        {
          name: 'workspace',
          manifestPath: path.join(root, 'conanfile.txt'),
          packages: [
            {
              name: 'fmt',
              requested: '10.2.1',
              installed: '10.2.1',
              latest: '12.2.0',
              status: 'outdated',
              scope: 'production',
            },
            {
              name: 'zlib',
              requested: '[>=1.2 <2]',
              installed: '1.3.1',
              latest: '1.3.2',
              status: 'outdated',
              scope: 'production',
            },
            {
              name: 'missing',
              requested: '[*]',
              installed: null,
              latest: null,
              status: 'unknown',
              scope: 'production',
            },
            {
              name: 'gtest',
              requested: '1.14.0',
              installed: '1.14.0',
              latest: '1.14.0',
              status: 'current',
              scope: 'development',
            },
          ],
        },
      ],
    });
    // ConanCenter is public: nothing was asked of Studio, and nothing was sent to it.
    expect(asks).toEqual([]);
    expect(seen.every((request: Seen): boolean => request.authorization === undefined)).toBe(true);
  });

  it('load_bothConanfiles_readsThePyOneAsConanDoes', async () => {
    // Arrange
    mkdirSync(path.join(root, 'lib'));
    writeFileSync(path.join(root, 'lib', 'conanfile.txt'), '[requires]\nzlib/1.3.1\n');
    writeFileSync(
      path.join(root, 'lib', 'conanfile.py'),
      'class Lib(ConanFile):\n    name = "mylib"\n    requires = "fmt/12.2.0"\n',
    );

    // Act
    const model: PackageManagerModel | null = await manager.load(root);

    // Assert
    expect(model?.projects).toMatchObject([
      {
        name: 'mylib',
        manifestPath: path.join(root, 'lib', 'conanfile.py'),
        packages: [{ name: 'fmt', installed: '12.2.0', latest: '12.2.0', status: 'current' }],
      },
    ]);
  });

  it('load_aPrivateRemote_usesConanCredentialsFirstThenStudiosToken', async () => {
    // Arrange
    writeFileSync(
      path.join(home, '.conan2', 'remotes.json'),
      JSON.stringify({
        remotes: [
          { name: 'plain', url: 'http://plain.example.com' },
          { name: 'other', url: 'https://other.example.com' },
          { name: 'company', url: 'https://conan.example.com' },
          { name: 'conancenter', url: 'https://center2.conan.io' },
        ],
      }),
    );
    writeFileSync(
      path.join(home, '.conan2', 'credentials.json'),
      JSON.stringify({
        credentials: [
          { remote: 'company', user: 'me', password: 'secret' },
          { remote: 'plain', user: 'me', password: 'never-sent' },
        ],
      }),
    );
    writeFileSync(path.join(root, 'conanfile.txt'), '[requires]\ninternal/2.0.0\n');

    // Act
    const model: PackageManagerModel | null = await manager.load(root);

    // Assert
    expect(model?.projects[0].packages[0]).toMatchObject({ name: 'internal', latest: '2.1.0' });
    expect(asks).toEqual(['https://other.example.com']);
    const byHost: (host: string) => string | undefined = (host: string): string | undefined =>
      seen.find((request: Seen): boolean => new URL(request.url).hostname === host)?.authorization;
    expect(byHost('conan.example.com')).toBe(
      `Basic ${Buffer.from('me:secret').toString('base64')}`,
    );
    expect(byHost('other.example.com')).toBe('Bearer studio-token');
    // ⛔ A credential is never sent over plain http, even one Conan's own file names for it.
    expect(byHost('plain.example.com')).toBeUndefined();
    expect(seen.some((request: Seen): boolean => request.url.startsWith('http://plain'))).toBe(
      true,
    );
  });

  it('search_aQuery_groupsVersionsByRecipeExactThenPrefixThenRest', async () => {
    // Arrange
    const query: string = 'fmt';

    // Act
    const page: PackageSearchResult = await manager.search('conancenter', query, {
      skip: 0,
      take: 10,
      prerelease: false,
    });

    // Assert
    expect(page).toEqual({
      items: [
        {
          name: 'fmt',
          version: '12.2.0',
          description: '',
          downloads: null,
          verified: false,
          sourceName: 'conancenter',
        },
        {
          name: 'fmtlog',
          version: '2.3.0',
          description: '',
          downloads: null,
          verified: false,
          sourceName: 'conancenter',
        },
        {
          name: 'libfmt',
          version: '1.0',
          description: '',
          downloads: null,
          verified: false,
          sourceName: 'conancenter',
        },
      ],
      total: 3,
      hasMore: false,
    });
    expect(seen.map((request: Seen): string => request.url)).toEqual([
      'https://center2.conan.io/v2/conans/search?q=*fmt*',
    ]);
  });

  it('search_anUnknownRemoteOrEmptyQuery_isEmptyAndAsksNothing', async () => {
    // Arrange
    const options: { skip: number; take: number; prerelease: boolean } = {
      skip: 0,
      take: 10,
      prerelease: false,
    };

    // Act
    const unknown: PackageSearchResult = await manager.search('nowhere', 'fmt', options);
    const empty: PackageSearchResult = await manager.search('conancenter', '  *  ', options);

    // Assert
    expect(unknown).toEqual({ items: [], total: 0, hasMore: false });
    expect(empty).toEqual({ items: [], total: 0, hasMore: false });
    expect(seen).toEqual([]);
  });

  it('listSources_namesTheRemotesOnly', async () => {
    // Arrange
    writeFileSync(
      path.join(home, '.conan2', 'remotes.json'),
      JSON.stringify({ remotes: [{ name: 'company', url: 'https://me:pw@conan.example.com' }] }),
    );

    // Act
    const sources: readonly { name: string }[] = await manager.listSources();

    // Assert
    expect(sources).toEqual([{ name: 'company' }]);
  });
});
