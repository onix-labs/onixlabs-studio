import {
  PackageSearchItem,
  PackageSearchOptions,
  PackageSearchResult,
} from '@shared/api/package-management';
import { NuGetSource } from './nuget-sources';
import { HttpFetch } from './package-manager';

/**
 * The `@type` of the flat-container (package base address) resource in a NuGet v3 service index.
 */
const PACKAGE_BASE_ADDRESS: string = 'PackageBaseAddress/3.0.0';

/**
 * The `@type` prefix of the search-query resource in a NuGet v3 service index (versioned variants all
 * share this prefix).
 */
const SEARCH_QUERY_SERVICE: string = 'SearchQueryService';

/**
 * Caches the resolved flat-container base URL of a source's service index, so the index is fetched once
 * per load rather than per package.
 */
export type FlatContainerCache = Map<string, string | null>;

/**
 * Fetches the latest stable version of a package by trying each configured source in turn: the first
 * source that returns any versions wins. Returns null when no source resolves the package (unknown id,
 * or every source failed). Never throws.
 * @param id The package id.
 * @param sources The resolved package sources, in precedence order.
 * @param fetchFn The HTTP fetch to use (injected for testing).
 * @param cache The per-load flat-container resolution cache.
 * @returns Returns the latest stable version, or null.
 */
export async function fetchLatestVersion(
  id: string,
  sources: readonly NuGetSource[],
  fetchFn: HttpFetch,
  cache: FlatContainerCache,
): Promise<string | null> {
  for (const source of sources) {
    const base: string | null = await resolveFlatContainer(source, fetchFn, cache);
    if (base === null) {
      continue;
    }
    const latest: string | null = await latestFromBase(base, id, source.headers, fetchFn);
    if (latest !== null) {
      return latest;
    }
  }
  return null;
}

/**
 * Resolves a source's flat-container (package base address) URL: for a v3 service index (`index.json`)
 * it fetches the index and reads the `PackageBaseAddress/3.0.0` resource; a source that already points
 * at a base address is used as-is. Cached per source URL. Returns null when the index cannot be read or
 * declares no flat-container resource.
 * @param source The package source.
 * @param fetchFn The HTTP fetch to use.
 * @param cache The per-load resolution cache.
 * @returns Returns the flat-container base URL (no trailing slash), or null.
 */
export async function resolveFlatContainer(
  source: NuGetSource,
  fetchFn: HttpFetch,
  cache: FlatContainerCache,
): Promise<string | null> {
  const cached: string | null | undefined = cache.get(source.url);
  if (cached !== undefined) {
    return cached;
  }
  const resolved: string | null = await resolveUncached(source, fetchFn);
  cache.set(source.url, resolved);
  return resolved;
}

/**
 * Resolves a source's flat-container base without consulting the cache.
 * @param source The package source.
 * @param fetchFn The HTTP fetch to use.
 * @returns Returns the base URL, or null.
 */
async function resolveUncached(source: NuGetSource, fetchFn: HttpFetch): Promise<string | null> {
  if (!/^https?:/i.test(source.url)) {
    return null;
  }
  if (!source.url.toLowerCase().endsWith('index.json')) {
    return stripTrailingSlash(source.url);
  }
  try {
    const response: Awaited<ReturnType<HttpFetch>> = await fetchFn(source.url, {
      headers: source.headers,
    });
    if (!response.ok) {
      return null;
    }
    return baseAddressFromIndex(await response.json());
  } catch {
    return null;
  }
}

/**
 * Reads the flat-container base address from a parsed v3 service index's `resources`.
 * @param index The parsed service index.
 * @returns Returns the base URL (no trailing slash), or null when absent.
 */
export function baseAddressFromIndex(index: unknown): string | null {
  if (typeof index !== 'object' || index === null) {
    return null;
  }
  const resources: unknown = (index as { resources?: unknown }).resources;
  if (!Array.isArray(resources)) {
    return null;
  }
  for (const resource of resources) {
    if (typeof resource !== 'object' || resource === null) {
      continue;
    }
    const type: unknown = (resource as { '@type'?: unknown })['@type'];
    const id: unknown = (resource as { '@id'?: unknown })['@id'];
    if (
      typeof type === 'string' &&
      type.startsWith(PACKAGE_BASE_ADDRESS) &&
      typeof id === 'string'
    ) {
      return stripTrailingSlash(id);
    }
  }
  return null;
}

/**
 * Reads the search-query service URL from a parsed v3 service index's `resources`.
 * @param index The parsed service index.
 * @returns Returns the search service URL (no trailing slash), or null when absent.
 */
export function searchServiceFromIndex(index: unknown): string | null {
  if (typeof index !== 'object' || index === null) {
    return null;
  }
  const resources: unknown = (index as { resources?: unknown }).resources;
  if (!Array.isArray(resources)) {
    return null;
  }
  for (const resource of resources) {
    if (typeof resource !== 'object' || resource === null) {
      continue;
    }
    const type: unknown = (resource as { '@type'?: unknown })['@type'];
    const id: unknown = (resource as { '@id'?: unknown })['@id'];
    if (
      typeof type === 'string' &&
      type.startsWith(SEARCH_QUERY_SERVICE) &&
      typeof id === 'string'
    ) {
      return stripTrailingSlash(id);
    }
  }
  return null;
}

/**
 * Parses a NuGet search response body into result items and the reported total, tagging each with the
 * source it came from. Malformed entries are skipped.
 * @param body The parsed search response.
 * @param sourceName The name of the source the results came from.
 * @returns Returns the items and the total match count.
 */
export function parseNuGetSearch(
  body: unknown,
  sourceName: string,
): { items: PackageSearchItem[]; total: number } {
  if (typeof body !== 'object' || body === null) {
    return { items: [], total: 0 };
  }
  const record: { totalHits?: unknown; data?: unknown } = body;
  const total: number = typeof record.totalHits === 'number' ? record.totalHits : 0;
  const data: unknown[] = Array.isArray(record.data) ? record.data : [];
  const items: PackageSearchItem[] = [];
  for (const entry of data) {
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }
    const item: {
      id?: unknown;
      version?: unknown;
      description?: unknown;
      totalDownloads?: unknown;
      verified?: unknown;
    } = entry;
    if (typeof item.id !== 'string' || item.id.length === 0) {
      continue;
    }
    items.push({
      name: item.id,
      version: typeof item.version === 'string' ? item.version : '',
      description: typeof item.description === 'string' ? item.description : '',
      downloads: typeof item.totalDownloads === 'number' ? item.totalDownloads : null,
      verified: item.verified === true,
      sourceName,
    });
  }
  return { items, total };
}

/**
 * Searches (or browses, with an empty query) a source's packages: resolves the source's search service
 * from its v3 index (cached), queries it with the paging and prerelease options and the source's auth,
 * and parses the results. Never throws — a failure yields an empty page.
 * @param source The package source to search.
 * @param query The search text, or empty to browse.
 * @param options The paging and prerelease options.
 * @param fetchFn The HTTP fetch to use.
 * @param cache The per-manager search-service resolution cache.
 * @returns Returns a page of results.
 */
export async function fetchSearch(
  source: NuGetSource,
  query: string,
  options: PackageSearchOptions,
  fetchFn: HttpFetch,
  cache: FlatContainerCache,
): Promise<PackageSearchResult> {
  const service: string | null = await resolveSearchService(source, fetchFn, cache);
  if (service === null) {
    return { items: [], total: 0, hasMore: false };
  }
  const url: string =
    `${service}?q=${encodeURIComponent(query)}` +
    `&skip=${options.skip}&take=${options.take}` +
    `&prerelease=${options.prerelease ? 'true' : 'false'}&semVerLevel=2.0.0`;
  try {
    const response: Awaited<ReturnType<HttpFetch>> = await fetchFn(url, {
      headers: source.headers,
    });
    if (!response.ok) {
      return { items: [], total: 0, hasMore: false };
    }
    const parsed: { items: PackageSearchItem[]; total: number } = parseNuGetSearch(
      await response.json(),
      source.name,
    );
    return {
      items: parsed.items,
      total: parsed.total,
      hasMore: options.skip + parsed.items.length < parsed.total,
    };
  } catch {
    return { items: [], total: 0, hasMore: false };
  }
}

/**
 * Resolves a source's search-query service URL from its v3 service index (cached per source URL), or
 * null when the source is not a v3 index or declares no search resource.
 * @param source The package source.
 * @param fetchFn The HTTP fetch to use.
 * @param cache The per-manager search-service resolution cache.
 * @returns Returns the search service URL, or null.
 */
async function resolveSearchService(
  source: NuGetSource,
  fetchFn: HttpFetch,
  cache: FlatContainerCache,
): Promise<string | null> {
  const cached: string | null | undefined = cache.get(source.url);
  if (cached !== undefined) {
    return cached;
  }
  let resolved: string | null = null;
  if (/^https?:/i.test(source.url) && source.url.toLowerCase().endsWith('index.json')) {
    try {
      const response: Awaited<ReturnType<HttpFetch>> = await fetchFn(source.url, {
        headers: source.headers,
      });
      if (response.ok) {
        resolved = searchServiceFromIndex(await response.json());
      }
    } catch {
      resolved = null;
    }
  }
  cache.set(source.url, resolved);
  return resolved;
}

/**
 * Fetches a package's versions from a flat-container base and picks the latest stable, applying the
 * source's auth headers. Returns null on any failure.
 * @param base The flat-container base URL.
 * @param id The package id.
 * @param headers The source's request headers.
 * @param fetchFn The HTTP fetch to use.
 * @returns Returns the latest stable version, or null.
 */
async function latestFromBase(
  base: string,
  id: string,
  headers: Record<string, string>,
  fetchFn: HttpFetch,
): Promise<string | null> {
  const url: string = `${base}/${encodeURIComponent(id.toLowerCase())}/index.json`;
  try {
    const response: Awaited<ReturnType<HttpFetch>> = await fetchFn(url, { headers });
    if (!response.ok) {
      return null;
    }
    return latestStableFromVersions(await response.json());
  } catch {
    return null;
  }
}

/**
 * Picks the latest stable version from a flat-container `{ versions: [...] }` body: the last entry with
 * no prerelease suffix (the versions are served in ascending order), falling back to the last version
 * of all when every published version is a prerelease. Returns null when the body has no versions.
 * @param body The parsed flat-container response.
 * @returns Returns the latest stable version, or null.
 */
export function latestStableFromVersions(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) {
    return null;
  }
  const versions: unknown = (body as { versions?: unknown }).versions;
  if (!Array.isArray(versions)) {
    return null;
  }
  const all: string[] = versions.filter(
    (entry: unknown): entry is string => typeof entry === 'string',
  );
  const stable: string[] = all.filter((version: string): boolean => !version.includes('-'));
  const pool: string[] = stable.length > 0 ? stable : all;
  return pool.length > 0 ? pool[pool.length - 1] : null;
}

/**
 * Strips a trailing slash from a URL so bases compose predictably.
 * @param url The URL.
 * @returns Returns the URL without a trailing slash.
 */
function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}
