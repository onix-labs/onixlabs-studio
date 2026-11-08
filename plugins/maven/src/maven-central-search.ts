// Searches Maven Central, the one JVM repository with a public search.
//
// `search.maven.org/solrsearch/select` is Maven Central's documented search API and answers without a
// key. (central.sonatype.com's own search is an internal API behind a bot wall, so it is not used.) A
// private repository — a Nexus, an Artifactory, GitHub Packages — has a search of its own if any, each
// different, so only Maven Central is offered as a source to search.
//
// What the index gives is thin: no description and no download counts, and its `latestVersion` can
// trail the repository by a while. The panel is told exactly that much: an empty description, no
// downloads, and the version the index has.

import { note } from './log';
import { HttpFetch, HttpResponse, PackageSearchItem, PackageSearchResult } from './protocol';

/**
 * The search's address.
 */
export const MAVEN_CENTRAL_SEARCH: string = 'https://search.maven.org/solrsearch/select';

/**
 * The name the source is shown by.
 */
export const MAVEN_CENTRAL_SOURCE: string = 'Maven Central';

/**
 * The most results the index returns in one page.
 */
const MAX_ROWS: number = 200;

/**
 * Turns the user's text into the index's query: `group:artifact` is looked up as exactly that, and
 * anything else is the index's own free-text search.
 * @param query The text.
 * @returns Returns the query.
 */
export function searchQuery(query: string): string {
  const coordinates: RegExpExecArray | null = /^([\w.-]+):([\w.-]+)$/.exec(query.trim());
  return coordinates === null ? query.trim() : `g:"${coordinates[1]}" AND a:"${coordinates[2]}"`;
}

/**
 * Searches Maven Central.
 * @param base The search's address (a loopback fake in specs).
 * @param query The text, which must not be empty.
 * @param skip How many results to skip.
 * @param take How many to return.
 * @param fetchFn The fetch requests go through.
 * @returns Returns a page of results; an empty one when the index cannot be reached or answers badly.
 */
export async function searchMavenCentral(
  base: string,
  query: string,
  skip: number,
  take: number,
  fetchFn: HttpFetch,
): Promise<PackageSearchResult> {
  const empty: PackageSearchResult = { items: [], total: 0, hasMore: false };
  if (query.trim().length === 0) {
    return empty;
  }
  const rows: number = Math.max(1, Math.min(MAX_ROWS, Math.floor(take)));
  const start: number = Math.max(0, Math.floor(skip));
  const url: string = `${base}?q=${encodeURIComponent(searchQuery(query))}&rows=${rows}&start=${start}&wt=json`;
  let body: unknown;
  try {
    const response: HttpResponse = await fetchFn(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'ONIXLabs-Studio-Maven-Plugin' },
    });
    if (!response.ok) {
      note('maven', `Maven Central's search answered ${response.status}`);
      return empty;
    }
    body = await response.json();
  } catch {
    note('maven', "Could not reach Maven Central's search");
    return empty;
  }
  return readSearch(body, start);
}

/**
 * Reads the index's answer.
 * @param body The parsed answer.
 * @param start How many results were skipped.
 * @returns Returns the page.
 */
export function readSearch(body: unknown, start: number): PackageSearchResult {
  const response: unknown = (body as { response?: unknown } | null)?.response;
  const numFound: unknown = (response as { numFound?: unknown } | undefined)?.numFound;
  const docs: unknown = (response as { docs?: unknown } | undefined)?.docs;
  if (!Array.isArray(docs)) {
    return { items: [], total: 0, hasMore: false };
  }
  const items: PackageSearchItem[] = [];
  for (const doc of docs as unknown[]) {
    const record: Record<string, unknown> =
      typeof doc === 'object' && doc !== null ? (doc as Record<string, unknown>) : {};
    const group: unknown = record['g'];
    const artifact: unknown = record['a'];
    const version: unknown = record['latestVersion'] ?? record['v'];
    if (typeof group === 'string' && typeof artifact === 'string') {
      items.push({
        name: `${group}:${artifact}`,
        version: typeof version === 'string' ? version : '',
        description: '',
        downloads: null,
        verified: false,
        sourceName: MAVEN_CENTRAL_SOURCE,
      });
    }
  }
  const total: number = typeof numFound === 'number' ? numFound : items.length;
  return { items, total, hasMore: start + items.length < total };
}
