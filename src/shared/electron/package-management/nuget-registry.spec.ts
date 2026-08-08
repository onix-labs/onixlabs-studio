import {
  baseAddressFromIndex,
  fetchLatestVersion,
  FlatContainerCache,
  latestStableFromVersions,
} from './nuget-registry';
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
