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

describe('the two resolvers agree on a Studio-managed server', () => {
  // This is the whole of the "managed server URL reaches the agent" requirement (#414). The model
  // manager starts its server listening at `resolveOllamaOrigin`, and the AI SDK adapter talks to
  // `resolveOllamaBaseUrl`, so a server Studio starts must be one the agent can reach. They agree by
  // construction — both read the same environment — and this pins it, so a change to either is caught
  // rather than silently pointing the agent at a server that is not there.
  //
  // Only the cases where Studio derives the address are covered. An explicit `OLLAMA_BASE_URL` is the
  // user taking over the endpoint, and is passed through verbatim (see below) — Studio does not append
  // anything to it or second-guess it.
  for (const env of [
    {},
    { OLLAMA_HOST: 'box:11434' },
    { OLLAMA_HOST: '127.0.0.1:99' },
    { OLLAMA_HOST: 'https://box:11434' },
  ]) {
    it(`for ${JSON.stringify(env)}`, () => {
      expect(resolveOllamaBaseUrl(env)).toBe(`${resolveOllamaOrigin(env)}/v1`);
    });
  }

  it('passes an explicit OLLAMA_BASE_URL through verbatim, /v1 included or not', () => {
    // Ollama serves its OpenAI-compatible API under `/v1`, so a base URL set without it will not work
    // against Ollama itself — but it may well be a proxy that serves at the root, so the override is
    // honoured rather than corrected.
    expect(resolveOllamaBaseUrl({ OLLAMA_BASE_URL: 'http://box:1234' })).toBe('http://box:1234');
    expect(resolveOllamaBaseUrl({ OLLAMA_BASE_URL: 'http://box:1234/v1' })).toBe(
      'http://box:1234/v1',
    );
  });
});
