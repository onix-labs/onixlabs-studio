import { describe, expect, it } from 'vitest';
import { goEnvironmentFrom, GoEnvironment } from './go-env';
import { escapeModulePath, GoProxyClient, isModulePath, ProxyEndpoint } from './go-proxy';
import type { NetrcEntry } from './netrc';
import type { HttpFetch, HttpResponse } from './protocol';

/**
 * One request the fake proxy saw.
 */
interface Seen {
  /**
   * Gets the URL asked for.
   */
  readonly url: string;

  /**
   * Gets the Authorization header sent, if any.
   */
  readonly authorization: string | undefined;
}

/**
 * Builds a response.
 * @param status The status.
 * @param body The body, as text.
 * @returns Returns the response.
 */
function response(status: number, body: string): HttpResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: (): Promise<unknown> => Promise.resolve(JSON.parse(body) as unknown),
    text: (): Promise<string> => Promise.resolve(body),
  };
}

/**
 * Builds a fake proxy that answers from a table of URL to status and body, 404 for anything else, and
 * records what it was asked.
 * @param table The answers.
 * @returns Returns the fetch and what it saw.
 */
function fakeProxy(table: Record<string, [number, string]>): { fetchFn: HttpFetch; seen: Seen[] } {
  const seen: Seen[] = [];
  const fetchFn: HttpFetch = (
    url: string,
    init?: { headers?: Record<string, string> },
  ): Promise<HttpResponse> => {
    seen.push({ url, authorization: init?.headers?.['Authorization'] });
    const answer: [number, string] = table[url] ?? [404, 'not found'];
    return Promise.resolve(response(answer[0], answer[1]));
  };
  return { fetchFn, seen };
}

/**
 * Builds a client.
 * @param values The Go settings.
 * @param fetchFn The fetch.
 * @param netrc The `.netrc` entries.
 * @param token What Studio answers a credential ask with.
 * @returns Returns the client and the registries Studio was asked about.
 */
function client(
  values: Record<string, string>,
  fetchFn: HttpFetch,
  netrc: readonly NetrcEntry[] = [],
  token: string | null = null,
): { client: GoProxyClient; asked: string[] } {
  const asked: string[] = [];
  const environment: GoEnvironment = goEnvironmentFrom(values, { HOME: '/nowhere' });
  return {
    client: new GoProxyClient(
      environment,
      netrc,
      (registry: string): Promise<string | null> => {
        asked.push(registry);
        return Promise.resolve(token);
      },
      fetchFn,
    ),
    asked,
  };
}

/**
 * Nothing excluded.
 */
const NONE: ReadonlySet<string> = new Set<string>();

describe('escapeModulePath', () => {
  it('escapeModulePath_capitals_becomeBangAndLowerCase', () => {
    expect(escapeModulePath('github.com/BurntSushi/toml')).toBe('github.com/!burnt!sushi/toml');
  });
});

describe('isModulePath', () => {
  it.each<[string, boolean]>([
    ['github.com/a/b', true],
    ['gopkg.in/yaml.v3', true],
    ['-flag', false],
    ['github.com/../etc', false],
    ['github.com/a?x=1', false],
    ['github.com/a b', false],
    ['github.com/a/', false],
    ['', false],
  ])('isModulePath_%s_is%s', (candidate: string, expected: boolean) => {
    expect(isModulePath(candidate)).toBe(expected);
  });
});

describe('GoProxyClient.latest', () => {
  it('latest_defaultProxy_readsTheEscapedVersionList', async () => {
    // Arrange
    const proxy: { fetchFn: HttpFetch; seen: Seen[] } = fakeProxy({
      'https://proxy.golang.org/github.com/!burnt!sushi/toml/@v/list': [200, 'v1.2.0\nv1.3.2\n'],
    });

    // Act
    const latest: string | null = await client({}, proxy.fetchFn).client.latest(
      'github.com/BurntSushi/toml',
      NONE,
      'v1.2.0',
    );

    // Assert
    expect(latest).toBe('v1.3.2');
    expect(proxy.seen).toEqual([
      {
        url: 'https://proxy.golang.org/github.com/!burnt!sushi/toml/@v/list',
        authorization: undefined,
      },
    ]);
  });

  it('latest_noTags_asksForLatest', async () => {
    // Arrange
    const proxy: { fetchFn: HttpFetch; seen: Seen[] } = fakeProxy({
      'https://proxy.golang.org/example.com/untagged/@v/list': [200, ''],
      'https://proxy.golang.org/example.com/untagged/@latest': [
        200,
        '{"Version":"v0.0.0-20240101000000-abcdefabcdef"}',
      ],
    });

    // Act
    const latest: string | null = await client({}, proxy.fetchFn).client.latest(
      'example.com/untagged',
      NONE,
      null,
    );

    // Assert
    expect(latest).toBe('v0.0.0-20240101000000-abcdefabcdef');
  });

  it('latest_commaFallsThroughOnlyOnNotFound', async () => {
    // Arrange
    const proxy: { fetchFn: HttpFetch; seen: Seen[] } = fakeProxy({
      'https://first.example/example.com/a/@v/list': [404, ''],
      'https://second.example/example.com/a/@v/list': [200, 'v1.0.0'],
      'https://first.example/example.com/b/@v/list': [500, ''],
      'https://second.example/example.com/b/@v/list': [200, 'v1.0.0'],
    });
    const go: GoProxyClient = client(
      { GOPROXY: 'https://first.example,https://second.example' },
      proxy.fetchFn,
    ).client;

    // Act, Assert
    await expect(go.latest('example.com/a', NONE, null)).resolves.toBe('v1.0.0');
    await expect(go.latest('example.com/b', NONE, null)).resolves.toBeNull();
  });

  it('latest_pipeFallsThroughOnAnyError', async () => {
    // Arrange
    const proxy: { fetchFn: HttpFetch; seen: Seen[] } = fakeProxy({
      'https://first.example/example.com/b/@v/list': [500, ''],
      'https://second.example/example.com/b/@v/list': [200, 'v1.1.0'],
    });

    // Act
    const latest: string | null = await client(
      { GOPROXY: 'https://first.example|https://second.example' },
      proxy.fetchFn,
    ).client.latest('example.com/b', NONE, null);

    // Assert
    expect(latest).toBe('v1.1.0');
  });

  it('latest_offOrDirect_makesNoRequest', async () => {
    // Arrange
    const proxy: { fetchFn: HttpFetch; seen: Seen[] } = fakeProxy({});

    // Act
    const off: string | null = await client({ GOPROXY: 'off' }, proxy.fetchFn).client.latest(
      'example.com/a',
      NONE,
      null,
    );
    const direct: string | null = await client({ GOPROXY: 'direct' }, proxy.fetchFn).client.latest(
      'example.com/a',
      NONE,
      null,
    );

    // Assert
    expect([off, direct]).toEqual([null, null]);
    expect(proxy.seen).toEqual([]);
  });

  it('latest_privateModule_isNeverSentToAProxy', async () => {
    // Arrange
    const proxy: { fetchFn: HttpFetch; seen: Seen[] } = fakeProxy({});

    // Act
    const latest: string | null = await client(
      { GOPRIVATE: 'corp.example' },
      proxy.fetchFn,
    ).client.latest('corp.example/secret/lib', NONE, null);

    // Assert
    expect(latest).toBeNull();
    expect(proxy.seen).toEqual([]);
  });

  it('latest_noSumDbModule_skipsThePublicProxyButAsksAPrivateOne', async () => {
    // Arrange
    const proxy: { fetchFn: HttpFetch; seen: Seen[] } = fakeProxy({
      'https://athens.corp.example/corp.example/lib/@v/list': [200, 'v2.0.0'],
    });

    // Act
    const latest: string | null = await client(
      {
        GOPROXY: 'https://proxy.golang.org,https://athens.corp.example',
        GONOSUMDB: 'corp.example',
      },
      proxy.fetchFn,
    ).client.latest('corp.example/lib', NONE, null);

    // Assert
    expect(latest).toBe('v2.0.0');
    expect(proxy.seen.map((seen: Seen): string => seen.url)).toEqual([
      'https://athens.corp.example/corp.example/lib/@v/list',
    ]);
  });

  it('latest_excludedVersion_isPassedOver', async () => {
    // Arrange
    const proxy: { fetchFn: HttpFetch; seen: Seen[] } = fakeProxy({
      'https://proxy.golang.org/example.com/a/@v/list': [200, 'v1.0.0\nv1.1.0'],
    });

    // Act
    const latest: string | null = await client({}, proxy.fetchFn).client.latest(
      'example.com/a',
      new Set<string>(['v1.1.0']),
      null,
    );

    // Assert
    expect(latest).toBe('v1.0.0');
  });

  it('latest_networkFailure_isNull', async () => {
    // Arrange
    const failing: HttpFetch = (): Promise<never> => Promise.reject(new Error('offline'));

    // Act, Assert
    await expect(
      client({}, failing).client.latest('example.com/a', NONE, null),
    ).resolves.toBeNull();
  });

  it('latest_notAModulePath_makesNoRequest', async () => {
    // Arrange
    const proxy: { fetchFn: HttpFetch; seen: Seen[] } = fakeProxy({});

    // Act
    const latest: string | null = await client({}, proxy.fetchFn).client.latest(
      'example.com/a/../../x',
      NONE,
      null,
    );

    // Assert
    expect(latest).toBeNull();
    expect(proxy.seen).toEqual([]);
  });
});

describe('GoProxyClient credentials', () => {
  it('credentials_userInUrl_isSentAsBasicAndKeptOutOfTheName', async () => {
    // Arrange
    const proxy: { fetchFn: HttpFetch; seen: Seen[] } = fakeProxy({
      'https://corp.example/go/example.com/a/@v/list': [200, 'v1.0.0'],
    });
    const go: GoProxyClient = client(
      { GOPROXY: 'https://alice:s3cret@corp.example/go' },
      proxy.fetchFn,
    ).client;

    // Act
    await go.latest('example.com/a', NONE, null);
    const proxies: readonly ProxyEndpoint[] = await go.proxies();

    // Assert
    expect(proxy.seen[0].authorization).toBe(
      `Basic ${Buffer.from('alice:s3cret').toString('base64')}`,
    );
    expect(proxies.map((endpoint: ProxyEndpoint): string => endpoint.name)).toEqual([
      'corp.example/go',
    ]);
  });

  it('credentials_netrcEntry_isSentToItsMachineOnly', async () => {
    // Arrange
    const proxy: { fetchFn: HttpFetch; seen: Seen[] } = fakeProxy({
      'https://corp.example/example.com/a/@v/list': [404, ''],
      'https://other.example/example.com/a/@v/list': [200, 'v1.0.0'],
    });
    const netrc: readonly NetrcEntry[] = [
      { machine: 'corp.example', login: 'bob', password: 'pw' },
    ];

    // Act
    await client(
      { GOPROXY: 'https://corp.example,https://other.example' },
      proxy.fetchFn,
      netrc,
      null,
    ).client.latest('example.com/a', NONE, null);

    // Assert
    expect(proxy.seen.map((seen: Seen): string | undefined => seen.authorization)).toEqual([
      `Basic ${Buffer.from('bob:pw').toString('base64')}`,
      undefined,
    ]);
  });

  it('credentials_goauthOff_ignoresNetrc', async () => {
    // Arrange
    const proxy: { fetchFn: HttpFetch; seen: Seen[] } = fakeProxy({});
    const netrc: readonly NetrcEntry[] = [
      { machine: 'corp.example', login: 'bob', password: 'pw' },
    ];

    // Act
    await client(
      { GOPROXY: 'https://corp.example', GOAUTH: 'off' },
      proxy.fetchFn,
      netrc,
    ).client.latest('example.com/a', NONE, null);

    // Assert
    expect(proxy.seen[0].authorization).toBeUndefined();
  });

  it('credentials_noConfiguredOne_asksStudioForAPrivateHttpsProxyOnce', async () => {
    // Arrange
    const proxy: { fetchFn: HttpFetch; seen: Seen[] } = fakeProxy({});
    const built: { client: GoProxyClient; asked: string[] } = client(
      { GOPROXY: 'https://corp.example/go' },
      proxy.fetchFn,
      [],
      'tok',
    );

    // Act
    await built.client.latest('example.com/a', NONE, null);
    await built.client.latest('example.com/b', NONE, null);

    // Assert
    expect(built.asked).toEqual(['https://corp.example/go']);
    expect(proxy.seen[0].authorization).toBe('Bearer tok');
  });

  it('credentials_studioTokenWithAColon_isSentAsBasic', async () => {
    // Arrange
    const proxy: { fetchFn: HttpFetch; seen: Seen[] } = fakeProxy({});

    // Act
    await client({ GOPROXY: 'https://corp.example' }, proxy.fetchFn, [], 'user:pass').client.latest(
      'example.com/a',
      NONE,
      null,
    );

    // Assert
    expect(proxy.seen[0].authorization).toBe(
      `Basic ${Buffer.from('user:pass').toString('base64')}`,
    );
  });

  it('credentials_publicProxyOrPlainHttp_neverAsksStudioNorSendsOne', async () => {
    // Arrange
    const proxy: { fetchFn: HttpFetch; seen: Seen[] } = fakeProxy({});
    const netrc: readonly NetrcEntry[] = [
      { machine: 'plain.example', login: 'bob', password: 'pw' },
    ];
    const built: { client: GoProxyClient; asked: string[] } = client(
      { GOPROXY: 'https://proxy.golang.org|http://bob:pw@plain.example' },
      proxy.fetchFn,
      netrc,
      'tok',
    );

    // Act
    await built.client.latest('example.com/a', NONE, null);

    // Assert
    expect(built.asked).toEqual([]);
    expect(proxy.seen.map((seen: Seen): string | undefined => seen.authorization)).toEqual([
      undefined,
      undefined,
    ]);
    expect(proxy.seen[1].url).toBe('http://plain.example/example.com/a/@v/list');
  });
});

describe('GoProxyClient.lookUp', () => {
  it('lookUp_namedProxy_answersTheModuleOrNothing', async () => {
    // Arrange
    const proxy: { fetchFn: HttpFetch; seen: Seen[] } = fakeProxy({
      'https://proxy.golang.org/golang.org/x/mod/@v/list': [200, 'v0.20.0'],
    });
    const go: GoProxyClient = client({}, proxy.fetchFn).client;

    // Act, Assert
    await expect(go.lookUp('proxy.golang.org', 'golang.org/x/mod')).resolves.toBe('v0.20.0');
    await expect(go.lookUp('proxy.golang.org', 'golang.org/x/none')).resolves.toBeNull();
    await expect(go.lookUp('unknown.example', 'golang.org/x/mod')).resolves.toBeNull();
  });

  it('lookUp_privateModuleOnAPublicProxy_isNotSent', async () => {
    // Arrange
    const proxy: { fetchFn: HttpFetch; seen: Seen[] } = fakeProxy({});

    // Act
    const found: string | null = await client(
      { GONOSUMDB: 'corp.example' },
      proxy.fetchFn,
    ).client.lookUp('proxy.golang.org', 'corp.example/lib');

    // Assert
    expect(found).toBeNull();
    expect(proxy.seen).toEqual([]);
  });
});
