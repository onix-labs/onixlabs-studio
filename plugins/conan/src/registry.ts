// Speaks to a Conan remote: the Conan v2 REST search, `GET <remote>/v2/conans/search?q=<pattern>`.
//
// ConanCenter and Artifactory's Conan repositories both answer it with `{ "results": [references] }`,
// one reference per recipe version (`fmt/12.2.0@_/_`), and match `*` in the pattern. A plain name is an
// exact match, so the same call gives one package's versions (for the latest) and, with `*` around the
// text, a search. Results carry no descriptions or download counts, so none are given.

import { ConanReference, isExactVersion, parseReference } from './conanfile';
import { note } from './log';
import { HttpFetch, HttpResponse } from './protocol';
import { ConanRemote } from './remotes';

/**
 * Searches a remote for recipes matching a pattern.
 * @param remote The remote.
 * @param pattern The pattern, already cut down to name characters and `*`.
 * @param fetchFn The fetch requests go through.
 * @returns Returns the references found, or null when the remote could not answer.
 */
export async function searchReferences(
  remote: ConanRemote,
  pattern: string,
  fetchFn: HttpFetch,
): Promise<readonly ConanReference[] | null> {
  let response: HttpResponse;
  try {
    response = await fetchFn(`${remote.url}/v2/conans/search?q=${encodeURIComponent(pattern)}`, {
      headers: { Accept: 'application/json', ...remote.headers },
    });
  } catch (error: unknown) {
    note('conan', `Remote ${remote.name} could not be reached: ${(error as Error).message}`);
    return null;
  }
  // ConanCenter answers a search that matches nothing with an empty list; a 404 from another server
  // means the same — nothing by that name — rather than that the remote is broken.
  if (response.status === 404) {
    return [];
  }
  if (!response.ok) {
    note('conan', `Remote ${remote.name} answered ${response.status} to a search`);
    return null;
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return null;
  }
  const results: unknown =
    typeof body === 'object' && body !== null ? (body as Record<string, unknown>)['results'] : null;
  if (!Array.isArray(results)) {
    return null;
  }
  return results
    .map((entry: unknown): ConanReference | null =>
      typeof entry === 'string' ? parseReference(entry) : null,
    )
    .filter(
      (reference: ConanReference | null): reference is ConanReference =>
        reference !== null && isExactVersion(reference.version),
    );
}

/**
 * Cuts search text down to what a recipe name can hold, so it cannot change the pattern's meaning.
 * @param query The search text.
 * @returns Returns the cleaned text, empty when nothing is left.
 */
export function cleanQuery(query: string): string {
  return query
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_+.-]/g, '');
}
