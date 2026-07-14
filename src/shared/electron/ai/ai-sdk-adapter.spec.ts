import type { AiConnection, AiProviderKind } from '@shared/api/ai-types';
import type { AgentAuth } from './agent-provider';
import {
  AiSdkAdapter,
  clientFamily,
  kindSupportsImages,
  resolveEndpoint,
  resolveOllamaBaseUrl,
  usesLocalToolAppendix,
} from './ai-sdk-adapter';

/**
 * Builds a connection for the adapter tests.
 * @param kind The provider kind.
 * @param overrides Fields to override on the connection.
 * @returns Returns the connection.
 */
function connection(kind: AiProviderKind, overrides?: Partial<AiConnection>): AiConnection {
  return {
    id: `${kind}-conn`,
    kind,
    label: `${kind} connection`,
    auth: 'api-key',
    models: [{ id: 'm1', label: 'Model 1', contextWindow: 8_000 }],
    defaultModelId: 'm1',
    ...overrides,
  };
}

describe('clientFamily', () => {
  it('mapsHostedKindsToTheirDedicatedClientAndTheRestToOpenAICompatible', () => {
    expect(clientFamily('anthropic')).toBe('anthropic');
    expect(clientFamily('openai')).toBe('openai');
    expect(clientFamily('google')).toBe('google');
    expect(clientFamily('xai')).toBe('openai-compatible');
    expect(clientFamily('deepseek')).toBe('openai-compatible');
    expect(clientFamily('ollama')).toBe('openai-compatible');
    expect(clientFamily('openai-compatible')).toBe('openai-compatible');
    expect(clientFamily('custom')).toBe('openai-compatible');
  });
});

describe('kindSupportsImages', () => {
  it('isTrueOnlyForTheMultimodalHostedKinds', () => {
    expect(kindSupportsImages('anthropic')).toBe(true);
    expect(kindSupportsImages('openai')).toBe(true);
    expect(kindSupportsImages('google')).toBe(true);
    expect(kindSupportsImages('xai')).toBe(false);
    expect(kindSupportsImages('ollama')).toBe(false);
    expect(kindSupportsImages('custom')).toBe(false);
  });
});

describe('usesLocalToolAppendix', () => {
  it('isTrueForLocalAndSelfHostedKinds', () => {
    expect(usesLocalToolAppendix('ollama')).toBe(true);
    expect(usesLocalToolAppendix('openai-compatible')).toBe(true);
    expect(usesLocalToolAppendix('custom')).toBe(true);
    expect(usesLocalToolAppendix('anthropic')).toBe(false);
    expect(usesLocalToolAppendix('openai')).toBe(false);
  });
});

describe('resolveOllamaBaseUrl', () => {
  it('prefersOllamaBaseUrlAndStripsTrailingSlashes', () => {
    expect(resolveOllamaBaseUrl({ OLLAMA_BASE_URL: 'http://box:1234/v1/' })).toBe(
      'http://box:1234/v1',
    );
  });

  it('derivesFromOllamaHostAddingTheSchemeAndApiPath', () => {
    expect(resolveOllamaBaseUrl({ OLLAMA_HOST: 'box:11434' })).toBe('http://box:11434/v1');
    expect(resolveOllamaBaseUrl({ OLLAMA_HOST: 'https://box:11434' })).toBe('https://box:11434/v1');
  });

  it('defaultsToLocalhost', () => {
    expect(resolveOllamaBaseUrl({})).toBe('http://127.0.0.1:11434/v1');
  });
});

describe('resolveEndpoint', () => {
  it('usesTheConnectionsOwnBaseUrlWhenSet', () => {
    expect(
      resolveEndpoint(connection('custom', { baseUrl: 'https://gw.example/v1/' }), {}),
    ).toEqual({ baseUrl: 'https://gw.example/v1', name: 'custom' });
  });

  it('resolvesTheOllamaDefaultFromTheEnvironment', () => {
    expect(resolveEndpoint(connection('ollama'), { OLLAMA_HOST: 'box:1' })).toEqual({
      baseUrl: 'http://box:1/v1',
      name: 'ollama',
    });
  });

  it('usesWellKnownDefaultsForXaiAndDeepseek', () => {
    expect(resolveEndpoint(connection('xai'), {}).baseUrl).toBe('https://api.x.ai/v1');
    expect(resolveEndpoint(connection('deepseek'), {}).baseUrl).toBe('https://api.deepseek.com/v1');
  });

  it('leavesTheBaseUrlUndefinedForHostedSdksWithoutAnOverride', () => {
    expect(resolveEndpoint(connection('openai'), {}).baseUrl).toBeUndefined();
    expect(resolveEndpoint(connection('anthropic'), {}).baseUrl).toBeUndefined();
    expect(resolveEndpoint(connection('google'), {}).baseUrl).toBeUndefined();
  });
});

describe('AiSdkAdapter', () => {
  it('exposesTheConnectionsIdentityAndModels', () => {
    const adapter: AiSdkAdapter = new AiSdkAdapter(
      connection('openai', { id: 'my-openai', label: 'Work OpenAI' }),
    );

    expect(adapter.id).toBe('my-openai');
    expect(adapter.label).toBe('Work OpenAI');
    expect(adapter.defaultModelId).toBe('m1');
    expect(adapter.models).toHaveLength(1);
    expect(adapter.supportsImages).toBe(true);
  });

  it('reportsImageSupportFromTheKind', () => {
    expect(new AiSdkAdapter(connection('ollama')).supportsImages).toBe(false);
  });

  it('describesAvailabilityFromTheAuthKindAndKey', () => {
    const noneAuth: AgentAuth = { hasLocalLogin: false, apiKey: null };
    expect(
      new AiSdkAdapter(connection('ollama', { auth: 'none' })).describeAvailability(noneAuth),
    ).toMatchObject({ available: true });

    const keyed: AiSdkAdapter = new AiSdkAdapter(connection('openai'));
    expect(keyed.describeAvailability({ hasLocalLogin: false, apiKey: 'sk-x' }).available).toBe(
      true,
    );
    expect(keyed.describeAvailability({ hasLocalLogin: false, apiKey: null }).available).toBe(
      false,
    );
  });
});
