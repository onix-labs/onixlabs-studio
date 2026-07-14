import type {
  AiConnection,
  AiDiscoverModelsResult,
  AiModelInfo,
  AiProviderKind,
} from '@shared/api/ai-types';
import {
  type DiscoveryTarget,
  discoveryTarget,
  type HttpFetch,
  type HttpResponse,
  mergeModels,
  parseModelsResponse,
  runDiscovery,
} from './model-discovery';

/**
 * Builds a connection for the discovery tests.
 * @param kind The provider kind.
 * @param overrides Fields to override.
 * @returns Returns the connection.
 */
function connection(kind: AiProviderKind, overrides?: Partial<AiConnection>): AiConnection {
  return {
    id: `${kind}-conn`,
    kind,
    label: `${kind} connection`,
    auth: kind === 'ollama' ? 'none' : 'api-key',
    models: [],
    defaultModelId: '',
    ...overrides,
  };
}

/**
 * Builds a fake HTTP fetch returning a fixed JSON body, recording the requested url and headers.
 * @param body The JSON body to return.
 * @param options Response status overrides.
 * @returns Returns the fetch and a record of the last call.
 */
function fakeFetch(
  body: unknown,
  options?: { ok?: boolean; status?: number },
): { fetch: HttpFetch; calls: { url: string; headers?: Record<string, string> }[] } {
  const calls: { url: string; headers?: Record<string, string> }[] = [];
  const fetch: HttpFetch = (
    url: string,
    init?: { headers?: Record<string, string> },
  ): Promise<HttpResponse> => {
    calls.push({ url, headers: init?.headers });
    return Promise.resolve({
      ok: options?.ok ?? true,
      status: options?.status ?? 200,
      json: (): Promise<unknown> => Promise.resolve(body),
    });
  };
  return { fetch, calls };
}

describe('parseModelsResponse', () => {
  it('readsOpenAIStyleData', () => {
    expect(parseModelsResponse({ data: [{ id: 'gpt-4o' }, { id: 'o3' }] })).toEqual([
      { id: 'gpt-4o' },
      { id: 'o3' },
    ]);
  });

  it('readsDisplayNamesAsLabels', () => {
    expect(parseModelsResponse({ data: [{ id: 'claude-x', display_name: 'Claude X' }] })).toEqual([
      { id: 'claude-x', label: 'Claude X' },
    ]);
  });

  it('ignoresMalformedEntriesAndShapes', () => {
    expect(parseModelsResponse({ data: [{ id: 'ok' }, {}, { id: 7 }, null, 'x'] })).toEqual([
      { id: 'ok' },
    ]);
    expect(parseModelsResponse({ data: 'nope' })).toEqual([]);
    expect(parseModelsResponse(null)).toEqual([]);
  });
});

describe('mergeModels', () => {
  it('keepsExistingModelsWithTheirFlagsAndAppendsNewOnes', () => {
    const existing: AiModelInfo[] = [
      { id: 'manual', label: 'Manual', contextWindow: 9_000, pinned: true },
    ];

    const merged: AiModelInfo[] = mergeModels(existing, [{ id: 'manual' }, { id: 'gpt-4o' }]);

    expect(merged).toHaveLength(2);
    expect(merged[0]).toEqual({
      id: 'manual',
      label: 'Manual',
      contextWindow: 9_000,
      pinned: true,
    });
    expect(merged[1]).toMatchObject({ id: 'gpt-4o', label: 'gpt-4o', contextWindow: 128_000 });
  });

  it('doesNotDuplicateOrReorderAndUsesDisplayNames', () => {
    const merged: AiModelInfo[] = mergeModels(
      [{ id: 'a', label: 'A', contextWindow: 1_000 }],
      [{ id: 'b', label: 'Bee' }, { id: 'a' }],
    );

    expect(merged.map((m: AiModelInfo): string => m.id)).toEqual(['a', 'b']);
    expect(merged[1]?.label).toBe('Bee');
  });
});

describe('discoveryTarget', () => {
  it('googleIsUnsupported', () => {
    const target: DiscoveryTarget = discoveryTarget(connection('google'), 'k', {});
    expect('unsupported' in target).toBe(true);
  });

  it('openAIStyleUsesBearerAuthAgainstTheHostedDefault', () => {
    const target: DiscoveryTarget = discoveryTarget(connection('openai'), 'sk-x', {});
    expect(target).toEqual({
      url: 'https://api.openai.com/v1/models',
      headers: { Authorization: 'Bearer sk-x' },
    });
  });

  it('anthropicUsesTheKeyHeaderAndVersion', () => {
    const target: DiscoveryTarget = discoveryTarget(connection('anthropic'), 'sk-a', {});
    expect(target).toMatchObject({
      url: 'https://api.anthropic.com/v1/models',
      headers: { 'x-api-key': 'sk-a', 'anthropic-version': '2023-06-01' },
    });
  });

  it('anthropicWithoutAKeyIsUnsupported', () => {
    expect(discoveryTarget(connection('anthropic'), null, {})).toHaveProperty('unsupported');
  });

  it('ollamaUsesTheLocalServerWithNoAuth', () => {
    const target: DiscoveryTarget = discoveryTarget(connection('ollama'), null, {
      OLLAMA_HOST: 'box:1',
    });
    expect(target).toEqual({ url: 'http://box:1/v1/models', headers: {} });
  });

  it('customWithoutABaseUrlIsUnsupported', () => {
    expect(discoveryTarget(connection('custom'), 'k', {})).toHaveProperty('unsupported');
  });

  it('customWithABaseUrlMergesConnectionHeaders', () => {
    const target: DiscoveryTarget = discoveryTarget(
      connection('custom', { baseUrl: 'https://gw/v1', headers: { 'X-Org': 'acme' } }),
      'sk-x',
      {},
    );
    expect(target).toEqual({
      url: 'https://gw/v1/models',
      headers: { 'X-Org': 'acme', Authorization: 'Bearer sk-x' },
    });
  });
});

describe('runDiscovery', () => {
  it('mergesDiscoveredModelsOnSuccess', async () => {
    const conn: AiConnection = connection('openai', {
      models: [{ id: 'kept', label: 'Kept', contextWindow: 5_000 }],
    });
    const { fetch, calls } = fakeFetch({ data: [{ id: 'kept' }, { id: 'gpt-4o' }] });

    const result: AiDiscoverModelsResult = await runDiscovery(conn, 'sk-x', {}, fetch);

    expect(result.ok).toBe(true);
    expect(result.added).toBe(1);
    expect(result.models.map((m: AiModelInfo): string => m.id)).toEqual(['kept', 'gpt-4o']);
    expect(calls[0]?.url).toBe('https://api.openai.com/v1/models');
  });

  it('returnsTheExistingModelsUnchangedWhenUnsupported', async () => {
    const conn: AiConnection = connection('google', {
      models: [{ id: 'x', label: 'X', contextWindow: 1_000 }],
    });
    const { fetch } = fakeFetch({});

    const result: AiDiscoverModelsResult = await runDiscovery(conn, 'k', {}, fetch);

    expect(result.ok).toBe(false);
    expect(result.models).toBe(conn.models);
    expect(result.added).toBe(0);
  });

  it('reportsAnHttpError', async () => {
    const { fetch } = fakeFetch({}, { ok: false, status: 401 });

    const result: AiDiscoverModelsResult = await runDiscovery(
      connection('openai'),
      'sk-x',
      {},
      fetch,
    );

    expect(result.ok).toBe(false);
    expect(result.detail).toContain('401');
  });

  it('reportsAnUnreachableEndpoint', async () => {
    const fetch: HttpFetch = (): Promise<HttpResponse> => Promise.reject(new Error('ECONNREFUSED'));

    const result: AiDiscoverModelsResult = await runDiscovery(
      connection('openai'),
      'sk-x',
      {},
      fetch,
    );

    expect(result.ok).toBe(false);
    expect(result.detail).toContain('Could not reach');
  });

  it('reportsAnEmptyModelList', async () => {
    const { fetch } = fakeFetch({ data: [] });

    const result: AiDiscoverModelsResult = await runDiscovery(
      connection('openai'),
      'sk-x',
      {},
      fetch,
    );

    expect(result.ok).toBe(false);
    expect(result.detail).toContain('no models');
  });
});
