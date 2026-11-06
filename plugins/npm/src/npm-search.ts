import { note } from './log';
import { NpmSource } from './npm-sources';
import {
  HttpFetch,
  PackageSearchItem,
  PackageSearchOptions,
  PackageSearchResult,
} from './protocol';

/**
 * The answer when a search cannot be made or read: an empty page, so the panel shows no results rather
 * than an error for a registry that does not offer search at all.
 */
const NOTHING: PackageSearchResult = { items: [], total: 0, hasMore: false };

/**
 * Searches a registry through its `/-/v1/search` API, one page at a time.
 *
 * The registry needs text and reports latest versions only, which is why this plugin advertises
 * `searchRequiresQuery` and no `prerelease`. Never throws: a registry that fails or has no search
 * endpoint (GitHub Packages has none) answers with an empty page.
 * @param source The registry to search.
 * @param query The search text.
 * @param options The paging options.
 * @param fetchFn The HTTP fetch to use.
 * @returns Returns a page of results.
 */
export async function searchRegistry(
  source: NpmSource,
  query: string,
  options: PackageSearchOptions,
  fetchFn: HttpFetch,
): Promise<PackageSearchResult> {
  const parameters: URLSearchParams = new URLSearchParams({
    text: query,
    size: String(options.take),
    from: String(options.skip),
  });
  const url: string = `${source.endpoint.registry}/-/v1/search?${parameters.toString()}`;
  try {
    const response: Awaited<ReturnType<HttpFetch>> = await fetchFn(url, {
      headers: source.endpoint.headers,
    });
    if (!response.ok) {
      note('npm-search', `The registry answered a search with status ${response.status}`);
      return NOTHING;
    }
    return readResults(await response.json(), source.name, options);
  } catch {
    note('npm-search', 'A search could not be completed');
    return NOTHING;
  }
}

/**
 * Reads a page of results out of a search response, skipping an object that is not a package.
 * @param body The parsed response.
 * @param sourceName The source's name, stamped on each result.
 * @param options The paging options the page was asked with.
 * @returns Returns the page.
 */
export function readResults(
  body: unknown,
  sourceName: string,
  options: PackageSearchOptions,
): PackageSearchResult {
  const record: { objects?: unknown; total?: unknown } =
    typeof body === 'object' && body !== null ? body : {};
  const objects: readonly unknown[] = Array.isArray(record.objects) ? record.objects : [];
  const items: PackageSearchItem[] = objects
    .map((entry: unknown): PackageSearchItem | null => readItem(entry, sourceName))
    .filter((item: PackageSearchItem | null): item is PackageSearchItem => item !== null);
  const total: number =
    typeof record.total === 'number' && Number.isFinite(record.total) ? record.total : items.length;
  return { items, total, hasMore: options.skip + objects.length < total };
}

/**
 * Reads one result. The downloads a registry reports are the last month's, which is the figure the
 * Explore view shows; a registry that reports none is shown without one.
 * @param entry The search object.
 * @param sourceName The source's name.
 * @returns Returns the result, or null when it names no package.
 */
function readItem(entry: unknown, sourceName: string): PackageSearchItem | null {
  const record: { package?: unknown; downloads?: unknown } =
    typeof entry === 'object' && entry !== null ? entry : {};
  const details: { name?: unknown; version?: unknown; description?: unknown } =
    typeof record.package === 'object' && record.package !== null ? record.package : {};
  if (typeof details.name !== 'string' || details.name.length === 0) {
    return null;
  }
  const monthly: unknown = (record.downloads as { monthly?: unknown } | null | undefined)?.monthly;
  return {
    name: details.name,
    version: typeof details.version === 'string' ? details.version : '',
    description: typeof details.description === 'string' ? details.description : '',
    downloads: typeof monthly === 'number' && Number.isFinite(monthly) ? monthly : null,
    verified: false,
    sourceName,
  };
}
