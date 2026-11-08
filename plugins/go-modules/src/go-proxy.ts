// Latest-version lookups against the Go module proxy protocol (https://go.dev/ref/mod#goproxy-protocol).
//
// A proxy answers `GET <proxy>/<module>/@v/list` with the module's tagged versions, one per line, and
// `GET <proxy>/<module>/@latest` with `{"Version": …}` for a module with no tags. The module path is
// case-escaped first — every capital letter becomes `!` and its lower case — because proxies are often
// served from case-insensitive file systems.
//
// What decides whether a module is looked up at all, and where:
// - `GONOPROXY` (or `GOPRIVATE`) modules are fetched by the go command straight from version control,
//   never through a proxy, so they are not looked up: their status is unknown.
// - `GONOSUMDB` (or `GOPRIVATE`) modules have private names, so they are never sent to a public proxy;
//   a private proxy in the list may still be asked.
// - `off` and `direct` end the list: this plugin does not speak version control, so a module that would
//   be fetched directly has no latest version here.

import { Buffer } from 'node:buffer';
import { GoEnvironment, GoProxyEntry, matchesPatterns } from './go-env';
import { note } from './log';
import { NetrcEntry, netrcFor } from './netrc';
import { CredentialAsk, HttpFetch, HttpResponse } from './protocol';
import { isGoVersion, pickLatest } from './versions';

/**
 * The hosts of the public module proxies, which never see a private module's name and are never sent a
 * token saved in Studio.
 */
const PUBLIC_PROXIES: ReadonlySet<string> = new Set<string>([
  'proxy.golang.org',
  'goproxy.io',
  'goproxy.cn',
]);

/**
 * Matches a module path: slash-separated elements of letters, digits and `-._~`, as the go command
 * allows. Checked before a path is put into a URL or an argument list, so a path from a go.mod cannot
 * reach a proxy's query string, climb out of the module's URL, or be read as an option.
 */
const MODULE_PATH: RegExp = /^[A-Za-z0-9][A-Za-z0-9._~-]*(?:\/[A-Za-z0-9._~-]+)*$/;

/**
 * Determines whether a string is a module path.
 * @param candidate The candidate.
 * @returns Returns true when it is one.
 */
export function isModulePath(candidate: string): boolean {
  return (
    MODULE_PATH.test(candidate) &&
    candidate
      .split('/')
      .every((element: string): boolean => !element.startsWith('.') && !element.endsWith('.'))
  );
}

/**
 * Case-escapes a module path for a proxy URL: `github.com/BurntSushi/toml` becomes
 * `github.com/!burnt!sushi/toml`.
 * @param modulePath The module path.
 * @returns Returns the escaped path.
 */
export function escapeModulePath(modulePath: string): string {
  return modulePath.replace(/[A-Z]/g, (letter: string): string => `!${letter.toLowerCase()}`);
}

/**
 * A proxy, ready to be asked: its URL without any user in it, and the headers its requests carry.
 */
export interface ProxyEndpoint {
  /**
   * Gets the name shown to the user: the host and path. ⛔ Never the user or password.
   */
  readonly name: string;

  /**
   * Gets the URL requests are made under, without a user or password.
   */
  readonly url: string;

  /**
   * Gets whether this is a public proxy.
   */
  readonly isPublic: boolean;

  /**
   * Gets the headers every request carries: the credential, when there is one.
   */
  readonly headers: Record<string, string>;
}

/**
 * The outcome of asking one proxy about one module.
 */
type Answer =
  | { readonly kind: 'found'; readonly version: string | null }
  | { readonly kind: 'notFound' }
  | { readonly kind: 'failed' };

/**
 * Determines whether a URL is plain http to this machine, which the fake proxy in a spec is, and which
 * cannot be overheard on a network.
 * @param url The URL.
 * @returns Returns true for loopback http.
 */
function isLoopbackHttp(url: URL): boolean {
  return url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
}

/**
 * Names a proxy for the user: its host and path, with any user, password or query dropped.
 * @param url The proxy's URL.
 * @returns Returns the name.
 */
export function proxyName(url: URL): string {
  return `${url.host}${url.pathname.replace(/\/+$/, '')}`;
}

/**
 * Builds a Basic credential.
 * @param user The user.
 * @param password The password.
 * @returns Returns the header's value.
 */
function basic(user: string, password: string): string {
  return `Basic ${Buffer.from(`${user}:${password}`, 'utf8').toString('base64')}`;
}

/**
 * Asks a module proxy for latest versions, honouring the Go environment's proxy list and private
 * patterns. Holds what it has learned for the life of one request: one endpoint per proxy, so Studio is
 * asked for a token at most once, and one answer per module.
 */
export class GoProxyClient {
  /**
   * Holds the Go settings.
   */
  private readonly environment: GoEnvironment;

  /**
   * Holds the `.netrc` entries, empty when `GOAUTH` turns it off.
   */
  private readonly netrc: readonly NetrcEntry[];

  /**
   * Holds how to ask Studio for a token saved for a proxy.
   */
  private readonly credential: CredentialAsk;

  /**
   * Holds the fetch requests go through.
   */
  private readonly fetchFn: HttpFetch;

  /**
   * Holds each proxy's endpoint once built, keyed by its URL as configured.
   */
  private readonly endpoints: Map<string, Promise<ProxyEndpoint | null>> = new Map<
    string,
    Promise<ProxyEndpoint | null>
  >();

  /**
   * Initializes the client.
   * @param environment The Go settings.
   * @param netrc The `.netrc` entries.
   * @param credential Asks Studio for a token saved for a proxy.
   * @param fetchFn The fetch requests go through.
   */
  public constructor(
    environment: GoEnvironment,
    netrc: readonly NetrcEntry[],
    credential: CredentialAsk,
    fetchFn: HttpFetch,
  ) {
    this.environment = environment;
    this.netrc = environment.netrc ? netrc : [];
    this.credential = credential;
    this.fetchFn = fetchFn;
  }

  /**
   * Lists the proxies modules are looked up on, in order, up to `off` or `direct`.
   * @returns Returns their endpoints; one that cannot be read as a URL is left out.
   */
  public async proxies(): Promise<readonly ProxyEndpoint[]> {
    const endpoints: ProxyEndpoint[] = [];
    for (const entry of this.environment.proxies) {
      if (entry.kind !== 'proxy') {
        break;
      }
      const endpoint: ProxyEndpoint | null = await this.endpoint(entry.url);
      if (endpoint !== null) {
        endpoints.push(endpoint);
      }
    }
    return endpoints;
  }

  /**
   * Finds the latest version of a module, walking the proxy list as the go command does.
   * @param modulePath The module path.
   * @param excluded The versions the main modules exclude.
   * @param current The version required now, or null.
   * @returns Returns the latest version, or null when it is not looked up or not found.
   */
  public async latest(
    modulePath: string,
    excluded: ReadonlySet<string>,
    current: string | null,
  ): Promise<string | null> {
    if (!isModulePath(modulePath) || matchesPatterns(modulePath, this.environment.noProxy)) {
      return null;
    }
    for (const entry of this.environment.proxies) {
      if (entry.kind !== 'proxy') {
        return null;
      }
      const endpoint: ProxyEndpoint | null = await this.endpoint(entry.url);
      if (endpoint === null || !this.mayAsk(endpoint, modulePath)) {
        continue;
      }
      const answer: Answer = await this.ask(endpoint, modulePath, excluded, current);
      if (answer.kind === 'found') {
        return answer.version;
      }
      if (answer.kind === 'failed' && !this.fallsBack(entry)) {
        return null;
      }
    }
    return null;
  }

  /**
   * Looks one module up on one named proxy: the exact-path lookup search answers with.
   * @param name The proxy's name, as {@link proxies} gave it.
   * @param modulePath The module path.
   * @returns Returns the latest version, or null when the proxy is unknown, may not be asked about the
   * module, or does not have it.
   */
  public async lookUp(name: string, modulePath: string): Promise<string | null> {
    if (!isModulePath(modulePath) || matchesPatterns(modulePath, this.environment.noProxy)) {
      return null;
    }
    const endpoint: ProxyEndpoint | undefined = (await this.proxies()).find(
      (candidate: ProxyEndpoint): boolean => candidate.name === name,
    );
    if (endpoint === undefined || !this.mayAsk(endpoint, modulePath)) {
      return null;
    }
    const answer: Answer = await this.ask(endpoint, modulePath, new Set<string>(), null);
    return answer.kind === 'found' ? answer.version : null;
  }

  /**
   * Determines whether a proxy may be told a module's name: a public one is never told a private one.
   * @param endpoint The proxy.
   * @param modulePath The module path.
   * @returns Returns true when it may.
   */
  private mayAsk(endpoint: ProxyEndpoint, modulePath: string): boolean {
    return !(endpoint.isPublic && matchesPatterns(modulePath, this.environment.noSumDb));
  }

  /**
   * Determines whether a failure on an entry moves on to the next one.
   * @param entry The entry.
   * @returns Returns true when it does.
   */
  private fallsBack(entry: GoProxyEntry): boolean {
    return entry.kind === 'proxy' && entry.fallBackOnAnyError;
  }

  /**
   * Asks one proxy for a module's latest version: its version list, then `@latest` when it lists no
   * tags.
   * @param endpoint The proxy.
   * @param modulePath The module path.
   * @param excluded The versions the main modules exclude.
   * @param current The version required now, or null.
   * @returns Returns what the proxy said.
   */
  private async ask(
    endpoint: ProxyEndpoint,
    modulePath: string,
    excluded: ReadonlySet<string>,
    current: string | null,
  ): Promise<Answer> {
    const base: string = `${endpoint.url}/${escapeModulePath(modulePath)}`;
    const list: HttpResponse | null = await this.get(`${base}/@v/list`, endpoint);
    if (list === null) {
      return { kind: 'failed' };
    }
    if (!list.ok) {
      return list.status === 404 || list.status === 410 ? { kind: 'notFound' } : { kind: 'failed' };
    }
    let versions: readonly string[];
    try {
      versions = (await list.text()).split('\n').map((line: string): string => line.trim());
    } catch {
      return { kind: 'failed' };
    }
    const tagged: string | null = pickLatest(versions, excluded, current);
    if (tagged !== null) {
      return { kind: 'found', version: tagged };
    }
    const latest: HttpResponse | null = await this.get(`${base}/@latest`, endpoint);
    if (latest?.ok !== true) {
      return latest?.status === 404 || latest?.status === 410
        ? { kind: 'notFound' }
        : { kind: 'failed' };
    }
    try {
      const body: unknown = await latest.json();
      const version: unknown =
        typeof body === 'object' && body !== null
          ? (body as Record<string, unknown>)['Version']
          : undefined;
      return typeof version === 'string' && isGoVersion(version) && !excluded.has(version)
        ? { kind: 'found', version }
        : { kind: 'found', version: null };
    } catch {
      return { kind: 'failed' };
    }
  }

  /**
   * Makes one request.
   * @param url The URL.
   * @param endpoint The proxy, for its headers.
   * @returns Returns the response, or null when no answer came.
   */
  private async get(url: string, endpoint: ProxyEndpoint): Promise<HttpResponse | null> {
    try {
      return await this.fetchFn(url, { headers: endpoint.headers });
    } catch {
      note('go-proxy', `A module proxy (${endpoint.name}) could not be reached`);
      return null;
    }
  }

  /**
   * Builds a proxy's endpoint once, however many modules are looked up on it.
   * @param configured The proxy's URL as configured, perhaps with a user and password.
   * @returns Returns the endpoint, or null when the URL cannot be used.
   */
  private endpoint(configured: string): Promise<ProxyEndpoint | null> {
    let built: Promise<ProxyEndpoint | null> | undefined = this.endpoints.get(configured);
    if (built === undefined) {
      built = this.build(configured);
      this.endpoints.set(configured, built);
    }
    return built;
  }

  /**
   * Builds a proxy's endpoint and finds its credential: the user and password in its URL, then the
   * `.netrc` entry for its host, then a token saved in Studio. ⛔ A credential goes only over https (or
   * http to this machine), and only to the host it was configured for: the URL's own user goes to that
   * URL, a `.netrc` entry to its machine, and Studio is asked about this proxy by name. Studio is never
   * asked about a public proxy.
   * @param configured The proxy's URL as configured.
   * @returns Returns the endpoint, or null when the URL is not an http(s) URL.
   */
  private async build(configured: string): Promise<ProxyEndpoint | null> {
    let url: URL;
    try {
      url = new URL(configured);
    } catch {
      note('go-proxy', 'A GOPROXY entry is not a URL, so it is skipped');
      return null;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      note('go-proxy', `A GOPROXY entry uses ${url.protocol}, which is not looked up`);
      return null;
    }
    const user: string = decodeURIComponent(url.username);
    const password: string = decodeURIComponent(url.password);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    const isPublic: boolean = PUBLIC_PROXIES.has(url.hostname.toLowerCase());
    const endpoint: ProxyEndpoint = {
      name: proxyName(url),
      url: url.toString().replace(/\/+$/, ''),
      isPublic,
      headers: {},
    };
    const secure: boolean = url.protocol === 'https:' || isLoopbackHttp(url);
    if (!secure) {
      return endpoint;
    }
    if (user.length > 0) {
      return { ...endpoint, headers: { Authorization: basic(user, password) } };
    }
    const machine: NetrcEntry | null = netrcFor(this.netrc, url.hostname);
    if (machine !== null) {
      return { ...endpoint, headers: { Authorization: basic(machine.login, machine.password) } };
    }
    if (isPublic || url.protocol !== 'https:') {
      return endpoint;
    }
    const token: string | null = await this.credential(endpoint.url);
    if (token === null || token.length === 0) {
      return endpoint;
    }
    // A token saved as `user:password` is a Basic credential, as most private Go proxies take one;
    // anything else is a bearer token.
    const colon: number = token.indexOf(':');
    return {
      ...endpoint,
      headers: {
        Authorization:
          colon > 0 ? basic(token.slice(0, colon), token.slice(colon + 1)) : `Bearer ${token}`,
      },
    };
  }
}
