import { describe, expect, it } from 'vitest';
import { CargoRegistry } from './cargo-config';
import {
  CRATES_IO_API,
  fetchLatestVersion,
  findApi,
  indexPath,
  latestFromIndex,
  readSearch,
  requestHeaders,
  searchCrates,
  USER_AGENT,
} from './cargo-registry';
import type { HttpFetch, HttpResponse, PackageSearchResult } from './protocol';

/**
 * A private registry on https, named by the fixtures.
 */
const CORP: CargoRegistry = {
  name: 'corp',
  index: 'https://corp.example/index/',
  token: 'corp-token',
  isPublic: false,
};

/**
 * crates.io as it is when nothing replaces it.
 */
const CRATES_IO: CargoRegistry = {
  name: 'crates-io',
  index: 'https://index.crates.io/',
  token: null,
  isPublic: true,
};

/**
 * One request a fake registry saw.
 */
interface Seen {
  /**
   * Gets the URL.
   */
  readonly url: string;

  /**
   * Gets the headers.
   */
  readonly headers: Record<string, string>;
}

/**
 * A fake registry answering each URL from a table, and recording what it was asked.
 * @param answers The bodies, by URL; JSON bodies are given as objects.
 * @param seen Receives the requests.
 * @returns Returns the fetch.
 */
function fake(answers: Readonly<Record<string, unknown>>, seen: Seen[] = []): HttpFetch {
  return (url: string, init?: { headers?: Record<string, string> }): Promise<HttpResponse> => {
    seen.push({ url, headers: init?.headers ?? {} });
    const body: unknown = answers[url];
    const text: string = typeof body === 'string' ? body : JSON.stringify(body ?? {});
    return Promise.resolve({
      ok: body !== undefined,
      status: body === undefined ? 404 : 200,
      json: (): Promise<unknown> => Promise.resolve(JSON.parse(text)),
      text: (): Promise<string> => Promise.resolve(text),
    });
  };
}

/**
 * A sparse index file for a crate with releases, a yanked release and a prerelease.
 */
const INDEX_FILE: string = [
  '{"name":"serde","vers":"1.0.199","yanked":false}',
  '{"name":"serde","vers":"1.0.200","yanked":false}',
  '{"name":"serde","vers":"1.0.201","yanked":true}',
  'not json',
  '{"name":"serde","vers":"2.0.0-alpha.1","yanked":false}',
  '',
].join('\n');

describe('indexPath', () => {
  it('indexPath_eachNameLength_followsTheSparseLayout', () => {
    // Arrange
    const names: readonly string[] = ['a', 'ab', 'abc', 'Serde', 'tokio-util'];

    // Act
    const paths: readonly string[] = names.map(indexPath);

    // Assert
    expect(paths).toEqual(['1/a', '2/ab', '3/a/abc', 'se/rd/serde', 'to/ki/tokio-util']);
  });
});

describe('latestFromIndex', () => {
  it('latestFromIndex_withoutPrereleases_skipsYankedAndPrereleases', () => {
    // Arrange
    const body: string = INDEX_FILE;

    // Act
    const latest: string | null = latestFromIndex(body, false);

    // Assert
    expect(latest).toBe('1.0.200');
  });

  it('latestFromIndex_withPrereleases_mayAnswerOne', () => {
    // Arrange
    const body: string = INDEX_FILE;

    // Act
    const latest: string | null = latestFromIndex(body, true);

    // Assert
    expect(latest).toBe('2.0.0-alpha.1');
  });

  it('latestFromIndex_everythingYanked_answersNull', () => {
    // Arrange
    const body: string = '{"vers":"0.1.0","yanked":true}';

    // Act
    const latest: string | null = latestFromIndex(body, false);

    // Assert
    expect(latest).toBeNull();
  });
});

describe('fetchLatestVersion', () => {
  it('fetchLatestVersion_privateRegistry_sendsItsTokenAndAUserAgent', async () => {
    // Arrange
    const seen: Seen[] = [];
    const fetchFn: HttpFetch = fake({ 'https://corp.example/index/se/rd/serde': INDEX_FILE }, seen);

    // Act
    const latest: string | null = await fetchLatestVersion(
      'serde',
      CORP,
      'corp-token',
      false,
      fetchFn,
    );

    // Assert
    expect(latest).toBe('1.0.200');
    expect(seen[0].headers).toEqual({ 'User-Agent': USER_AGENT, Authorization: 'corp-token' });
  });

  it('fetchLatestVersion_unknownCrate_answersNull', async () => {
    // Arrange
    const fetchFn: HttpFetch = fake({});

    // Act
    const latest: string | null = await fetchLatestVersion('nope', CRATES_IO, null, false, fetchFn);

    // Assert
    expect(latest).toBeNull();
  });

  it('fetchLatestVersion_noIndex_asksNothing', async () => {
    // Arrange
    const seen: Seen[] = [];
    const vendored: CargoRegistry = { ...CRATES_IO, index: null, isPublic: false };

    // Act
    const latest: string | null = await fetchLatestVersion(
      'serde',
      vendored,
      null,
      false,
      fake({}, seen),
    );

    // Assert
    expect(latest).toBeNull();
    expect(seen).toEqual([]);
  });
});

describe('requestHeaders', () => {
  it('requestHeaders_plainHttpToAnotherHost_neverCarriesTheToken', () => {
    // Arrange
    const url: string = 'http://corp.example/index/se/rd/serde';

    // Act
    const headers: Record<string, string> = requestHeaders(url, 'secret');

    // Assert
    expect(headers).toEqual({ 'User-Agent': USER_AGENT });
  });

  it('requestHeaders_loopbackHttp_carriesTheToken', () => {
    // Arrange
    const url: string = 'http://127.0.0.1:4000/index/se/rd/serde';

    // Act
    const headers: Record<string, string> = requestHeaders(url, 'secret');

    // Assert
    expect(headers['Authorization']).toBe('secret');
  });
});

describe('findApi', () => {
  it('findApi_cratesIo_isCratesIosOwnApi', async () => {
    // Arrange
    const seen: Seen[] = [];

    // Act
    const api: string | null = await findApi(CRATES_IO, null, fake({}, seen));

    // Assert
    expect(api).toBe(CRATES_IO_API);
    expect(seen).toEqual([]);
  });

  it('findApi_registryDeclaringAnApi_readsItFromConfigJson', async () => {
    // Arrange
    const fetchFn: HttpFetch = fake({
      'https://corp.example/index/config.json': {
        dl: 'https://corp.example/dl',
        api: 'https://corp.example/',
      },
    });

    // Act
    const api: string | null = await findApi(CORP, 'corp-token', fetchFn);

    // Assert
    expect(api).toBe('https://corp.example');
  });

  it('findApi_registryWithNoApi_answersNull', async () => {
    // Arrange
    const fetchFn: HttpFetch = fake({
      'https://corp.example/index/config.json': { dl: 'https://corp.example/dl' },
    });

    // Act
    const api: string | null = await findApi(CORP, null, fetchFn);

    // Assert
    expect(api).toBeNull();
  });
});

describe('searchCrates', () => {
  /**
   * A search page as crates.io answers one.
   */
  const PAGE: unknown = {
    crates: [
      {
        name: 'serde',
        description: ' A serialization framework ',
        downloads: 1000,
        max_version: '2.0.0-alpha.1',
        max_stable_version: '1.0.200',
      },
      { name: 'only-pre', downloads: 3, max_version: '0.1.0-beta', max_stable_version: null },
    ],
    meta: { total: 2, next_page: null },
  };

  it('searchCrates_aQuery_asksForThePageWithAUserAgent', async () => {
    // Arrange
    const seen: Seen[] = [];
    const url: string = `${CRATES_IO_API}/api/v1/crates?q=serde&page=3&per_page=20`;

    // Act
    const page: PackageSearchResult = await searchCrates(
      CRATES_IO_API,
      'crates.io',
      'serde',
      { skip: 40, take: 20, prerelease: false },
      null,
      fake({ [url]: PAGE }, seen),
    );

    // Assert
    expect(seen[0]).toEqual({ url, headers: { 'User-Agent': USER_AGENT } });
    expect(page.items[0]).toEqual({
      name: 'serde',
      version: '1.0.200',
      description: 'A serialization framework',
      downloads: 1000,
      verified: false,
      sourceName: 'crates.io',
    });
  });

  it('searchCrates_noQuery_browsesByDownloads', async () => {
    // Arrange
    const seen: Seen[] = [];

    // Act
    await searchCrates(
      CRATES_IO_API,
      'crates.io',
      '',
      { skip: 0, take: 50, prerelease: false },
      null,
      fake({}, seen),
    );

    // Assert
    expect(seen[0].url).toContain('sort=downloads');
  });

  it('searchCrates_registryFails_answersAnEmptyPage', async () => {
    // Arrange
    const fetchFn: HttpFetch = (): Promise<never> => Promise.reject(new Error('down'));

    // Act
    const page: PackageSearchResult = await searchCrates(
      'https://corp.example',
      'corp',
      'x',
      { skip: 0, take: 10, prerelease: false },
      'corp-token',
      fetchFn,
    );

    // Assert
    expect(page).toEqual({ items: [], total: 0, hasMore: false });
  });
});

describe('readSearch', () => {
  /**
   * A page with a crate that has only prereleases.
   */
  const BODY: unknown = {
    crates: [
      { name: 'serde', max_version: '2.0.0-alpha.1', max_stable_version: '1.0.200' },
      { name: 'only-pre', max_version: '0.1.0-beta', max_stable_version: null },
      { name: 'old-registry', max_version: '0.3.0' },
    ],
    meta: { total: 30, next_page: '?page=2' },
  };

  it('readSearch_withoutPrereleases_showsStableVersionsAndDropsPrereleaseOnlyCrates', () => {
    // Arrange
    const options: { skip: number; take: number; prerelease: boolean } = {
      skip: 0,
      take: 3,
      prerelease: false,
    };

    // Act
    const page: PackageSearchResult = readSearch(BODY, 'crates.io', options);

    // Assert
    expect(
      page.items.map(
        (item: { name: string; version: string }): string => `${item.name}@${item.version}`,
      ),
    ).toEqual(['serde@1.0.200', 'old-registry@0.3.0']);
    expect(page).toMatchObject({ total: 30, hasMore: true });
  });

  it('readSearch_withPrereleases_showsTheHighestVersion', () => {
    // Arrange
    const options: { skip: number; take: number; prerelease: boolean } = {
      skip: 0,
      take: 3,
      prerelease: true,
    };

    // Act
    const page: PackageSearchResult = readSearch(BODY, 'crates.io', options);

    // Assert
    expect(page.items.map((item: { version: string }): string => item.version)).toEqual([
      '2.0.0-alpha.1',
      '0.1.0-beta',
      '0.3.0',
    ]);
  });
});
