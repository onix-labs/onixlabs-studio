// Speaks to Cargo registries: the sparse index for latest versions, and the web API for search.
//
// Latest versions come from the sparse index (`index.crates.io`), not the API: it is a CDN made for
// exactly this, with no rate limit, and every registry cargo can use from HTTP has one. Search has no
// index form, so it goes to the registry's web API (`/api/v1/crates`), which crates.io offers and an
// alternative registry may or may not: its `config.json` says where, and one without an `api` answers
// an empty page rather than a pretend search.

import { note } from './log';
import { CargoRegistry, CRATES_IO, CRATES_IO_DISPLAY } from './cargo-config';
import {
  HttpFetch,
  HttpResponse,
  PackageSearchItem,
  PackageSearchOptions,
  PackageSearchResult,
} from './protocol';
import { compareVersions, isPrerelease } from './versions';

/**
 * The User-Agent every request carries. crates.io refuses requests without a descriptive one, and asks
 * that it say who is asking and how to reach them.
 */
export const USER_AGENT: string =
  'onixlabs-studio-cargo-plugin (+https://github.com/onix-labs/onixlabs-studio)';

/**
 * crates.io's web API, for search when crates.io is not replaced or its replacement has no API.
 */
export const CRATES_IO_API: string = 'https://crates.io';

/**
 * The most results crates.io returns on one page.
 */
const MAX_PER_PAGE: number = 100;

/**
 * The answer when a search cannot be made or read.
 */
const NOTHING: PackageSearchResult = { items: [], total: 0, hasMore: false };

/**
 * Builds the path of a crate's file in a sparse index, which is laid out by the length of the
 * lower-cased name: `1/a`, `2/ab`, `3/a/abc`, and `se/rd/serde` for four or more characters.
 * @param name The crate's name.
 * @returns Returns the path, relative to the index root.
 */
export function indexPath(name: string): string {
  const lower: string = name.toLowerCase();
  if (lower.length <= 2) {
    return `${lower.length}/${lower}`;
  }
  if (lower.length === 3) {
    return `3/${lower[0]}/${lower}`;
  }
  return `${lower.slice(0, 2)}/${lower.slice(2, 4)}/${lower}`;
}

/**
 * Builds the headers for a request: the User-Agent always, and a token only where it is safe to send.
 * ⛔ Never over plain http, except to the loopback interface (the fake registry the specs run).
 * Cargo sends a registry token as the whole `Authorization` value, with no scheme, and so does this.
 * @param url The request's URL.
 * @param token The token bound to the registry, or null.
 * @returns Returns the headers.
 */
export function requestHeaders(url: string, token: string | null): Record<string, string> {
  const headers: Record<string, string> = { 'User-Agent': USER_AGENT };
  if (token !== null && mayCarryCredential(url)) {
    headers['Authorization'] = token;
  }
  return headers;
}

/**
 * Determines whether a URL is one a credential may travel to: https, or http to the loopback interface.
 * @param url The URL.
 * @returns Returns true when a credential may be sent.
 */
export function mayCarryCredential(url: string): boolean {
  try {
    const parsed: URL = new URL(url);
    if (parsed.protocol === 'https:') {
      return true;
    }
    return (
      parsed.protocol === 'http:' &&
      ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname.toLowerCase())
    );
  } catch {
    return false;
  }
}

/**
 * Fetches a crate's latest version from a registry's sparse index: the highest version that is not
 * yanked, and not a prerelease unless asked for. Never throws: a registry that fails, or a crate it does
 * not know, is a row without a latest version rather than a failed load.
 * @param name The crate's name.
 * @param registry The registry.
 * @param token The token bound to it, or null.
 * @param includePrerelease Whether a prerelease may be the answer.
 * @param fetchFn The fetch to use.
 * @returns Returns the version, or null.
 */
export async function fetchLatestVersion(
  name: string,
  registry: CargoRegistry,
  token: string | null,
  includePrerelease: boolean,
  fetchFn: HttpFetch,
): Promise<string | null> {
  if (registry.index === null) {
    return null;
  }
  const url: string = `${registry.index}${indexPath(name)}`;
  try {
    const response: HttpResponse = await fetchFn(url, { headers: requestHeaders(url, token) });
    if (!response.ok) {
      return null;
    }
    return latestFromIndex(await response.text(), includePrerelease);
  } catch {
    note('cargo-registry', 'A sparse index lookup could not be completed');
    return null;
  }
}

/**
 * Reads the latest version out of a sparse index file: one JSON document per line, one per published
 * version, each with `vers` and `yanked`. A line that does not read is skipped.
 * @param body The file.
 * @param includePrerelease Whether a prerelease may be the answer.
 * @returns Returns the version, or null when there is none.
 */
export function latestFromIndex(body: string, includePrerelease: boolean): string | null {
  let latest: string | null = null;
  for (const line of body.split('\n')) {
    if (line.trim().length === 0) {
      continue;
    }
    let entry: { vers?: unknown; yanked?: unknown };
    try {
      entry = JSON.parse(line) as { vers?: unknown; yanked?: unknown };
    } catch {
      continue;
    }
    const version: unknown = entry.vers;
    if (
      typeof version !== 'string' ||
      entry.yanked === true ||
      (!includePrerelease && isPrerelease(version))
    ) {
      continue;
    }
    if (latest === null || compareVersions(version, latest) > 0) {
      latest = version;
    }
  }
  return latest;
}

/**
 * Finds a registry's web API: crates.io's own when it is crates.io, otherwise the `api` its index's
 * `config.json` declares. Never throws.
 * @param registry The registry.
 * @param token The token bound to it, or null. An index that needs one for reads (`auth-required`)
 * needs it for `config.json` too.
 * @param fetchFn The fetch to use.
 * @returns Returns the API's base URL without a trailing slash, or null when it declares none.
 */
export async function findApi(
  registry: CargoRegistry,
  token: string | null,
  fetchFn: HttpFetch,
): Promise<string | null> {
  if (registry.isPublic) {
    return CRATES_IO_API;
  }
  if (registry.index === null) {
    return null;
  }
  const url: string = `${registry.index}config.json`;
  try {
    const response: HttpResponse = await fetchFn(url, { headers: requestHeaders(url, token) });
    if (!response.ok) {
      return null;
    }
    const api: unknown = ((await response.json()) as { api?: unknown } | null)?.api;
    if (typeof api !== 'string') {
      return null;
    }
    const parsed: URL = new URL(api);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
      ? api.replace(/\/+$/, '')
      : null;
  } catch {
    note('cargo-registry', "A registry's config.json could not be read");
    return null;
  }
}

/**
 * Searches a registry's web API, one page at a time. An empty query browses by downloads, which
 * crates.io supports. Never throws: a registry that fails or has no search answers an empty page.
 * @param api The API's base URL.
 * @param sourceName The source's name, stamped on each result.
 * @param query The search text.
 * @param options The paging and prerelease options.
 * @param token The token bound to the registry, or null.
 * @param fetchFn The fetch to use.
 * @returns Returns the page.
 */
export async function searchCrates(
  api: string,
  sourceName: string,
  query: string,
  options: PackageSearchOptions,
  token: string | null,
  fetchFn: HttpFetch,
): Promise<PackageSearchResult> {
  const perPage: number = Math.max(1, Math.min(options.take, MAX_PER_PAGE));
  const parameters: URLSearchParams = new URLSearchParams({
    q: query,
    page: String(Math.floor(options.skip / perPage) + 1),
    per_page: String(perPage),
  });
  if (query.trim().length === 0) {
    parameters.set('sort', 'downloads');
  }
  const url: string = `${api}/api/v1/crates?${parameters.toString()}`;
  try {
    const response: HttpResponse = await fetchFn(url, { headers: requestHeaders(url, token) });
    if (!response.ok) {
      note('cargo-registry', `The registry answered a search with status ${response.status}`);
      return NOTHING;
    }
    return readSearch(await response.json(), sourceName, options);
  } catch {
    note('cargo-registry', 'A search could not be completed');
    return NOTHING;
  }
}

/**
 * Reads a page of search results.
 *
 * crates.io reports both `max_version` and `max_stable_version`, which is how prerelease is honoured:
 * with prereleases the highest version is shown, without them the highest stable one, and a crate with
 * no stable version at all is left off the page. A registry that reports only `max_version` is read the
 * same way from that.
 * @param body The parsed response.
 * @param sourceName The source's name.
 * @param options The options the page was asked with.
 * @returns Returns the page.
 */
export function readSearch(
  body: unknown,
  sourceName: string,
  options: PackageSearchOptions,
): PackageSearchResult {
  const record: { crates?: unknown; meta?: unknown } =
    typeof body === 'object' && body !== null ? body : {};
  const crates: readonly unknown[] = Array.isArray(record.crates) ? record.crates : [];
  const items: PackageSearchItem[] = crates
    .map((entry: unknown): PackageSearchItem | null => readItem(entry, sourceName, options))
    .filter((item: PackageSearchItem | null): item is PackageSearchItem => item !== null);
  const meta: { total?: unknown; next_page?: unknown } =
    typeof record.meta === 'object' && record.meta !== null ? record.meta : {};
  const total: number =
    typeof meta.total === 'number' && Number.isFinite(meta.total) ? meta.total : items.length;
  const hasMore: boolean =
    meta.next_page !== undefined
      ? typeof meta.next_page === 'string' && meta.next_page.length > 0
      : options.skip + crates.length < total;
  return { items, total, hasMore };
}

/**
 * Reads one search result.
 * @param entry The result.
 * @param sourceName The source's name.
 * @param options The options the page was asked with.
 * @returns Returns the result, or null when it names no crate or has no version to show.
 */
function readItem(
  entry: unknown,
  sourceName: string,
  options: PackageSearchOptions,
): PackageSearchItem | null {
  const record: {
    name?: unknown;
    description?: unknown;
    downloads?: unknown;
    max_version?: unknown;
    max_stable_version?: unknown;
  } = typeof entry === 'object' && entry !== null ? entry : {};
  if (typeof record.name !== 'string' || record.name.length === 0) {
    return null;
  }
  const highest: string | null = typeof record.max_version === 'string' ? record.max_version : null;
  let version: string | null = highest;
  if (!options.prerelease) {
    if (typeof record.max_stable_version === 'string') {
      version = record.max_stable_version;
    } else if (highest === null || isPrerelease(highest)) {
      return null;
    }
  }
  return {
    name: record.name,
    version: version ?? '',
    description: typeof record.description === 'string' ? record.description.trim() : '',
    downloads:
      typeof record.downloads === 'number' && Number.isFinite(record.downloads)
        ? record.downloads
        : null,
    verified: false,
    sourceName,
  };
}

/**
 * Names a registry for the panel: crates.io by its usual name, others by their configured name.
 * @param registry The registry.
 * @returns Returns the name.
 */
export function displayName(registry: CargoRegistry): string {
  return registry.name === CRATES_IO ? CRATES_IO_DISPLAY : registry.name;
}
