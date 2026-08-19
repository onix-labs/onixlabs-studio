import { describe, expect, it } from 'vitest';
import { resolveOllamaBaseUrl, resolveOllamaOrigin } from './ollama-endpoint';

describe('resolveOllamaBaseUrl', () => {
  it('prefers an explicit base URL, stripping trailing slashes', () => {
    expect(resolveOllamaBaseUrl({ OLLAMA_BASE_URL: 'http://box:1234/v1/' })).toBe(
      'http://box:1234/v1',
    );
  });

  it('builds the OpenAI-compatible URL from the host', () => {
    expect(resolveOllamaBaseUrl({ OLLAMA_HOST: 'box:11434' })).toBe('http://box:11434/v1');
    expect(resolveOllamaBaseUrl({ OLLAMA_HOST: 'https://box:11434' })).toBe('https://box:11434/v1');
  });

  it('falls back to the standard local address', () => {
    expect(resolveOllamaBaseUrl({})).toBe('http://127.0.0.1:11434/v1');
  });
});

describe('resolveOllamaOrigin', () => {
  it('strips the /v1 suffix off an explicit base URL, since the native API is on the same origin', () => {
    expect(resolveOllamaOrigin({ OLLAMA_BASE_URL: 'http://box:1234/v1/' })).toBe('http://box:1234');
    expect(resolveOllamaOrigin({ OLLAMA_BASE_URL: 'http://box:1234' })).toBe('http://box:1234');
  });

  it('adds a scheme to a bare host', () => {
    expect(resolveOllamaOrigin({ OLLAMA_HOST: 'box:11434' })).toBe('http://box:11434');
    expect(resolveOllamaOrigin({ OLLAMA_HOST: 'https://box:11434' })).toBe('https://box:11434');
  });

  it('falls back to the standard local address', () => {
    expect(resolveOllamaOrigin({})).toBe('http://127.0.0.1:11434');
  });
});
