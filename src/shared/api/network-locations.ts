/**
 * Hosts that are refused whatever the user has configured. The cloud-metadata address is the classic
 * pivot from "the agent can make a request" to "the agent has your cloud credentials": it answers only
 * from inside an instance, needs no authentication, and hands out role credentials. Nobody points an
 * API client at it deliberately, so denying it costs nothing and closes the sharpest edge.
 *
 * Loopback is deliberately NOT here. Testing a service on localhost is the API Explorer's most common
 * use, and the agent helping with it is the point of the feature.
 */
const ALWAYS_DENIED_HOSTS: ReadonlySet<string> = new Set<string>([
  '169.254.169.254',
  'metadata.google.internal',
]);

/**
 * Reduces a user-typed network location to the host it names, so the same list can be typed as
 * `https://api.example.com/v1`, `api.example.com:8443` or `api.example.com` and mean one thing. A
 * wildcard pattern (`*.example.com`) is preserved as written.
 * @param value The location as the user typed it.
 * @returns Returns the lower-cased host pattern, or an empty string when nothing usable remains.
 */
export function normaliseNetworkLocation(value: string): string {
  const trimmed: string = value.trim().toLowerCase();
  if (trimmed === '') {
    return '';
  }
  // Strip a scheme, then any path, query or fragment, then credentials, then a port. Done textually
  // rather than with `URL`, because the entries are patterns (`*.example.com`) that `URL` rejects.
  const withoutScheme: string = trimmed.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  const hostAndPort: string = withoutScheme.split(/[/?#]/)[0].split('@').pop() ?? '';
  const host: string = hostAndPort.startsWith('[')
    ? // An IPv6 literal keeps its brackets' contents; a trailing :port sits outside them.
      (/^\[([^\]]*)\]/.exec(hostAndPort)?.[1] ?? '')
    : hostAndPort.split(':')[0];
  return host;
}

/**
 * Cleans a configured list of network locations, dropping anything that does not name a host.
 * @param value The configured value, from settings or an untrusted request.
 * @returns Returns the normalised host patterns, without blanks or duplicates.
 */
export function sanitizeNetworkLocations(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const hosts: string[] = value
    .filter((entry: unknown): entry is string => typeof entry === 'string')
    .map((entry: string): string => normaliseNetworkLocation(entry))
    .filter((entry: string): boolean => entry.length > 0);
  return [...new Set<string>(hosts)];
}

/**
 * Determines whether a host matches a configured pattern: an exact host, or a `*.` wildcard that
 * matches any sub-domain and the bare domain itself (`*.example.com` matches `api.example.com` and
 * `example.com`, and never `notexample.com`).
 * @param host The host to test, lower-cased.
 * @param pattern The configured pattern, lower-cased.
 * @returns Returns true when the host matches.
 */
export function matchesNetworkLocation(host: string, pattern: string): boolean {
  if (pattern.startsWith('*.')) {
    const domain: string = pattern.slice(2);
    return host === domain || host.endsWith(`.${domain}`);
  }
  return host === pattern;
}

/**
 * Decides whether a request to a URL is permitted by the configured lists.
 *
 * The shape mirrors the write paths, because it is the same decision in a different medium: the
 * allow list **widens** (empty means "anywhere", which is the behaviour Studio has always had), the
 * deny list **narrows** and wins over the allow list, and a short built-in deny list holds regardless.
 * A URL that cannot be parsed is refused: an engine that cannot tell where a request is going cannot
 * claim it is allowed.
 * @param url The absolute URL the request is addressed to.
 * @param allowed The configured allowed locations, already sanitized.
 * @param denied The configured denied locations, already sanitized.
 * @returns Returns true when the request may proceed.
 */
export function isNetworkLocationAllowed(
  url: string,
  allowed: readonly string[],
  denied: readonly string[],
): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  // An IPv6 hostname arrives bracketed from `URL`; the configured form is bare.
  const bare: string = host.startsWith('[') ? host.slice(1, -1) : host;
  if (ALWAYS_DENIED_HOSTS.has(bare)) {
    return false;
  }
  if (denied.some((pattern: string): boolean => matchesNetworkLocation(bare, pattern))) {
    return false;
  }
  if (allowed.length === 0) {
    return true;
  }
  return allowed.some((pattern: string): boolean => matchesNetworkLocation(bare, pattern));
}

/**
 * Describes why a request was refused, for the message the agent is handed back. It names the
 * setting to change rather than only the fact of the refusal, because the boundary is configuration:
 * exactly as with the write paths, the agent cannot widen it by asking.
 * @param url The refused URL.
 * @returns Returns the explanation.
 */
export function networkLocationRefusal(url: string): string {
  return (
    `Blocked: "${url}" is not in the agent's allowed network locations. This is a fixed safety ` +
    `boundary — add the host to Settings › Artificial Intelligence › Allowed network locations to ` +
    `permit it.`
  );
}
