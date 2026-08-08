import {
  baseAddressFromIndex,
  fetchLatestVersion,
  fetchSearch,
  FlatContainerCache,
  latestStableFromVersions,
  parseNuGetSearch,
  searchServiceFromIndex,
} from './nuget-registry';
import { PackageSearchResult } from '@shared/api/package-management';
import { NuGetSource } from './nuget-sources';
import { HttpFetch, HttpResponse } from './package-manager';

/**
 * Builds a fake HTTP response over a JSON body.
 * @param ok Whether the status is a success.
 * @param body The JSON body.
 * @returns Returns the fake response.
 */
function response(ok: boolean, body: unknown): HttpResponse {
  return { ok, status: ok ? 200 : 404, json: (): Promise<unknown> => Promise.resolve(body) };
}

/**
 * The nuget.org service index resource shape, used to stub index resolution.
 */
const SERVICE_INDEX: unknown = {
  resources: [
    { '@type': 'PackageBaseAddress/3.0.0', '@id': 'https://api.nuget.org/v3-flatcontainer/' },
    { '@type': 'SearchQueryService/3.5.0', '@id': 'https://azuresearch-usnc.nuget.org/query' },
  ],
};

describe('latestStableFromVersions', () => {
  it('picks the last stable version, ignoring prereleases', () => {
    expect(latestStableFromVersions({ versions: ['1.0.0', '2.0.0', '2.1.0-preview.1'] })).toBe(
      '2.0.0',
    );
  });

  it('falls back to the last version when all are prerelease', () => {
    expect(latestStableFromVersions({ versions: ['1.0.0-rc.1', '1.0.0-rc.2'] })).toBe('1.0.0-rc.2');
  });

  it('is null for a missing or empty version list', () => {
    expect(latestStableFromVersions({ versions: [] })).toBeNull();
    expect(latestStableFromVersions(null)).toBeNull();
  });
});

describe('baseAddressFromIndex', () => {
  it('reads the PackageBaseAddress resource', () => {
    expect(baseAddressFromIndex(SERVICE_INDEX)).toBe(
      'https://api.nuget.org/v3-flatcontainer',
    );
  });

  it('is null when the resource is absent', () => {
    expect(baseAddressFromIndex({ resources: [] })).toBeNull();
    expect(baseAddressFromIndex(null)).toBeNull();
  });
});

describe('fetchLatestVersion', () => {
  const nugetOrg: NuGetSource = { name: 'nuget.org', url: 'https://api.nuget.org/v3/index.json', headers: {} };

  it('resolves the flat container from the service index, then the latest stable', async () => {
    const fetchFn: HttpFetch = (url: string): Promise<HttpResponse> => {
      if (url.endsWith('/v3/index.json')) {
        return Promise.resolve(response(true, SERVICE_INDEX));
      }
      expect(url).toBe('https://api.nuget.org/v3-flatcontainer/newtonsoft.json/index.json');
      return Promise.resolve(response(true, { versions: ['13.0.1', '13.0.3'] }));
    };
    const cache: FlatContainerCache = new Map<string, string | null>();
    await expect(fetchLatestVersion('Newtonsoft.Json', [nugetOrg], fetchFn, cache)).resolves.toBe(
      '13.0.3',
    );
  });

  it('sends the source auth headers and falls through to the next source', async () => {
    const privateFeed: NuGetSource = {
      name: 'github',
      url: 'https://nuget.pkg.github.com/acme/index.json',
      headers: { Authorization: 'Basic dXNlcjp0b2tlbg==' },
    };
    const seenAuth: (string | undefined)[] = [];
    const fetchFn: HttpFetch = (url: string, init?: { headers?: Record<string, string> }): Promise<HttpResponse> => {
      seenAuth.push(init?.headers?.['Authorization']);
      if (url.startsWith('https://nuget.pkg.github.com')) {
        // The private feed has no such package (empty versions), so resolution moves on.
        return url.endsWith('/index.json') && url.includes('/acme/')
          ? Promise.resolve(response(true, { resources: [{ '@type': 'PackageBaseAddress/3.0.0', '@id': 'https://nuget.pkg.github.com/acme/download/' }] }))
          : Promise.resolve(response(true, { versions: [] }));
      }
      if (url.endsWith('/v3/index.json')) {
        return Promise.resolve(response(true, SERVICE_INDEX));
      }
      return Promise.resolve(response(true, { versions: ['5.0.0'] }));
    };
    const cache: FlatContainerCache = new Map<string, string | null>();
    await expect(
      fetchLatestVersion('Shared.Lib', [privateFeed, nugetOrg], fetchFn, cache),
    ).resolves.toBe('5.0.0');
    expect(seenAuth).toContain('Basic dXNlcjp0b2tlbg==');
  });

  it('is null when no source resolves the package', async () => {
    const fetchFn: HttpFetch = (url: string): Promise<HttpResponse> =>
      url.endsWith('/v3/index.json')
        ? Promise.resolve(response(true, SERVICE_INDEX))
        : Promise.resolve(response(false, {}));
    const cache: FlatContainerCache = new Map<string, string | null>();
    await expect(fetchLatestVersion('Missing', [nugetOrg], fetchFn, cache)).resolves.toBeNull();
  });
});

describe('searchServiceFromIndex', () => {
  it('reads the versioned SearchQueryService resource', () => {
    expect(searchServiceFromIndex(SERVICE_INDEX)).toBe('https://azuresearch-usnc.nuget.org/query');
  });

  it('is null when absent', () => {
    expect(searchServiceFromIndex({ resources: [] })).toBeNull();
  });
});

describe('parseNuGetSearch', () => {
  it('maps result data and the total, tagging the source', () => {
    const body: unknown = {
      totalHits: 2,
      data: [
        { id: 'Serilog', version: '3.1.1', description: 'Logging', totalDownloads: 500_000_000, verified: true },
        { id: 'NoMeta' },
      ],
    };
    const parsed: { items: unknown[]; total: number } = parseNuGetSearch(body, 'nuget.org');
    expect(parsed.total).toBe(2);
    expect(parsed.items).toEqual([
      {
        name: 'Serilog',
        version: '3.1.1',
        description: 'Logging',
        downloads: 500_000_000,
        verified: true,
        sourceName: 'nuget.org',
      },
      { name: 'NoMeta', version: '', description: '', downloads: null, verified: false, sourceName: 'nuget.org' },
    ]);
  });
});

describe('fetchSearch', () => {
  it('resolves the search service, queries it with auth, and reports paging', async () => {
    const seenAuth: (string | undefined)[] = [];
    const fetchFn: HttpFetch = (url: string, init?: { headers?: Record<string, string> }): Promise<HttpResponse> => {
      seenAuth.push(init?.headers?.['Authorization']);
      if (url.endsWith('/v3/index.json')) {
        return Promise.resolve(response(true, SERVICE_INDEX));
      }
      expect(url).toContain('https://azuresearch-usnc.nuget.org/query?q=json');
      expect(url).toContain('prerelease=true');
      return Promise.resolve(
        response(true, { totalHits: 10, data: [{ id: 'Json.More', version: '1.0.0' }] }),
      );
    };
    const source: { name: string; url: string; headers: Record<string, string> } = {
      name: 'nuget.org',
      url: 'https://api.nuget.org/v3/index.json',
      headers: { Authorization: 'Basic abc' },
    };
    const cache: FlatContainerCache = new Map<string, string | null>();
    const result: PackageSearchResult = await fetchSearch(
      source,
      'json',
      { skip: 0, take: 1, prerelease: true },
      fetchFn,
      cache,
    );
    expect(result.total).toBe(10);
    expect(result.hasMore).toBe(true);
    expect(result.items.map((item): string => item.name)).toEqual(['Json.More']);
    expect(seenAuth).toContain('Basic abc');
  });
});
