// What core knows about a connection's endpoint — and nothing about running one.
//
// ⛔ This file used to hold `AiSdkAdapter`, the generic provider that served every connection no
// vendor-specific harness claimed. It is gone: core ships no provider at all, and that adapter is now
// `onixlabs.ai-sdk-harness` (#653). What is left is the part that was never a provider — which client
// family a kind belongs to, where its endpoint is, and whether it takes images. Model discovery reads
// it to decide where to send a `/models` request for a connection with no harness installed yet, and
// that is a question about a URL rather than about an agent.
//
// ⚠️ The filename is unchanged so the importers are not churned for a rename. If it grows again,
// `connection-endpoint.ts` is what it should be called.

import type { AiProviderKind } from '@shared/api/ai-types';
import { resolveOllamaBaseUrl } from './ollama-endpoint';

/**
 * The client family a kind is served by: the dedicated `@ai-sdk/*` package for the hosted providers
 * that have one, and the OpenAI-compatible client for everything else (xAI, DeepSeek, Ollama, and any
 * `openai-compatible` or `custom` endpoint the user points at by URL).
 */
export type ClientFamily = 'anthropic' | 'openai' | 'google' | 'openai-compatible';

/**
 * The default API endpoints for OpenAI-compatible kinds that have a well-known hosted URL. A connection
 * with its own {@link AiConnection.baseUrl} overrides these; `openai-compatible` and `custom` have no
 * default and must supply one.
 */
export const DEFAULT_BASE_URLS: Readonly<Partial<Record<AiProviderKind, string>>> = {
  xai: 'https://api.x.ai/v1',
  deepseek: 'https://api.deepseek.com/v1',
};

/**
 * Maps a provider kind to the client family that serves it.
 * @param kind The provider kind.
 * @returns Returns the client family.
 */
export function clientFamily(kind: AiProviderKind): ClientFamily {
  switch (kind) {
    case 'anthropic':
      return 'anthropic';
    case 'openai':
      return 'openai';
    case 'google':
      return 'google';
    default:
      // xai, deepseek, ollama, openai-compatible, custom — all OpenAI-compatible HTTP APIs.
      return 'openai-compatible';
  }
}

/**
 * Re-exported from {@link import('./ollama-endpoint')}, where it now lives alongside the native-API
 * origin resolver, so the callers that already import it from this module keep working.
 */
export { resolveOllamaBaseUrl };
