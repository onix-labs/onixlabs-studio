import { clientFamily, resolveOllamaBaseUrl } from './ai-sdk-adapter';

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
