import { NpmEndpoint } from './npmrc';
import { HttpFetch } from './protocol';

/**
 * Fetches the latest published version of an npm package from its resolved registry endpoint (which may
 * be a private/scoped registry, with auth headers), or null when it cannot be resolved (a network
 * failure, a non-success status, a private/unknown name, or a malformed body). Never throws: the caller
 * renders the package without an upgrade verdict rather than failing the model.
 * @param name The package name (possibly `@scope/name`).
 * @param endpoint The resolved registry URL and auth headers.
 * @param fetchFn The HTTP fetch to use (injected for testing).
 * @returns Returns the latest version string, or null.
 */
export async function fetchLatestVersion(
  name: string,
  endpoint: NpmEndpoint,
  fetchFn: HttpFetch,
): Promise<string | null> {
  // A scoped name is addressed as `@scope%2Fpkg`, as the npm CLI sends it: only a leading `@` is
  // restored, and every `/` stays encoded, so a name read from a workspace's package.json can never
  // add path segments (`../`) to a URL that carries the registry's credentials.
  const encoded: string = encodeURIComponent(name).replace(/^%40/, '@');
  const url: string = `${endpoint.registry}/${encoded}`;
  try {
    const response: Awaited<ReturnType<HttpFetch>> = await fetchFn(url, {
      headers: endpoint.headers,
    });
    if (!response.ok) {
      return null;
    }
    const body: unknown = await response.json();
    return latestFromMetadata(body);
  } catch {
    return null;
  }
}

/**
 * Extracts the `dist-tags.latest` version from an npm registry metadata body, or null when it is absent
 * or not a string.
 * @param body The parsed registry response.
 * @returns Returns the latest version, or null.
 */
export function latestFromMetadata(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) {
    return null;
  }
  const distTags: unknown = (body as { 'dist-tags'?: unknown })['dist-tags'];
  if (typeof distTags !== 'object' || distTags === null) {
    return null;
  }
  const latest: unknown = (distTags as { latest?: unknown }).latest;
  return typeof latest === 'string' && latest.length > 0 ? latest : null;
}
