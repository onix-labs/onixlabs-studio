// Discovers the models a connection offers by querying its `/models` endpoint, and merges them into the
// connection's existing list. The parsing, endpoint/header selection, and merge are pure and unit-
// testable; the single HTTP call is injected (the main process passes the real fetch), so the whole
// flow is exercised in tests with a fake fetch. OpenAI-compatible providers (OpenAI, xAI, DeepSeek,
// Ollama, and any custom endpoint) and Anthropic are supported; anything else degrades to "add models
// manually" rather than failing.

import type { AiConnection, AiDiscoverModelsResult, AiModelInfo } from '@shared/api/ai-types';
import { clientFamily, DEFAULT_BASE_URLS, resolveOllamaBaseUrl } from './ai-sdk-adapter';
import { describeRunError } from './ai-sdk-stream';
import { resolveContextWindow } from './context-windows';
import { logger } from '../logger';

/**
 * A model returned by a discovery endpoint.
 */
export interface DiscoveredModel {
  /**
   * Gets the model id.
   */
  readonly id: string;

  /**
   * Gets the model's display name, when the endpoint provides one.
   */
  readonly label?: string;
}

/**
 * A minimal HTTP response shape, so the discovery flow does not depend on the DOM or Node fetch types
 * (this module compiles under the renderer's browser type config for its tests).
 */
export interface HttpResponse {
  /**
   * Gets a value indicating whether the response status is in the success range.
   */
  readonly ok: boolean;

  /**
   * Gets the HTTP status code.
   */
  readonly status: number;

  /**
   * Reads the response body as parsed JSON.
   * @returns Returns the parsed body.
   */
  json(): Promise<unknown>;
}

/**
 * A minimal fetch signature, injected so discovery is testable without a network.
 */
export type HttpFetch = (
  url: string,
  init?: { headers?: Record<string, string> },
) => Promise<HttpResponse>;

/**
 * The concrete API bases used for discovery when a connection has no explicit base URL, keyed by kind.
 * Extends the run-time defaults with the hosted OpenAI and Anthropic endpoints (which the adapter
 * leaves to the SDK, but discovery must address directly).
 */
const DISCOVERY_BASE_URLS: Readonly<Partial<Record<AiConnection['kind'], string>>> = {
  ...DEFAULT_BASE_URLS,
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
};

/**
 * The endpoint and headers a discovery request is made with, or a reason it cannot run.
 */
export type DiscoveryTarget =
  | { readonly url: string; readonly headers: Record<string, string> }
  | { readonly unsupported: string };

/**
 * Parses an OpenAI/Anthropic-style `{ data: [{ id, display_name? }] }` models response into the
 * discovered models, ignoring malformed entries.
 * @param json The parsed response body.
 * @returns Returns the discovered models.
 */
export function parseModelsResponse(json: unknown): DiscoveredModel[] {
  if (typeof json !== 'object' || json === null) {
    return [];
  }
  const data: unknown = (json as { data?: unknown }).data;
  if (!Array.isArray(data)) {
    return [];
  }
  const models: DiscoveredModel[] = [];
  for (const entry of data) {
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }
    const id: unknown = (entry as { id?: unknown }).id;
    if (typeof id !== 'string' || id.length === 0) {
      continue;
    }
    const displayName: unknown = (entry as { display_name?: unknown }).display_name;
    models.push({
      id,
      ...(typeof displayName === 'string' && displayName.length > 0 ? { label: displayName } : {}),
    });
  }
  return models;
}

/**
 * Merges discovered models into a connection's existing list: every existing model is kept (with its
 * label, context window, and pin/hide flags — so manual entries and user edits survive a refresh), and
 * each newly-discovered id is appended with a resolved context window.
 * @param existing The connection's current models.
 * @param discovered The models returned by discovery.
 * @returns Returns the merged model list.
 */
export function mergeModels(
  existing: readonly AiModelInfo[],
  discovered: readonly DiscoveredModel[],
): AiModelInfo[] {
  const seen: Set<string> = new Set<string>(existing.map((model: AiModelInfo): string => model.id));
  const merged: AiModelInfo[] = [...existing];
  for (const model of discovered) {
    if (seen.has(model.id)) {
      continue;
    }
    seen.add(model.id);
    merged.push({
      id: model.id,
      label: model.label ?? model.id,
      contextWindow: resolveContextWindow(model.id),
    });
  }
  return merged;
}

/**
 * Resolves the concrete HTTP base URL a connection's models are discovered from, or null when the
 * connection's kind has no discoverable endpoint (or a custom endpoint has no base URL set).
 * @param connection The connection.
 * @param env The environment (for the Ollama default).
 * @returns Returns the base URL, or null.
 */
function discoveryBaseUrl(
  connection: AiConnection,
  env: Record<string, string | undefined>,
): string | null {
  if (connection.baseUrl !== undefined && connection.baseUrl.length > 0) {
    return connection.baseUrl.replace(/\/+$/, '');
  }
  if (connection.kind === 'ollama') {
    return resolveOllamaBaseUrl(env);
  }
  return DISCOVERY_BASE_URLS[connection.kind] ?? null;
}

/**
 * Resolves the discovery endpoint and headers for a connection, or the reason discovery cannot run
 * (an unsupported kind, a custom endpoint with no base URL, or a keyed provider with no key).
 * @param connection The connection.
 * @param apiKey The connection's resolved API key, or null.
 * @param env The environment (for the Ollama default).
 * @returns Returns the discovery target.
 */
export function discoveryTarget(
  connection: AiConnection,
  apiKey: string | null,
  env: Record<string, string | undefined>,
): DiscoveryTarget {
  const family: ReturnType<typeof clientFamily> = clientFamily(connection.kind);
  if (family === 'google') {
    return {
      unsupported: 'This provider does not support automatic model discovery. Add models manually.',
    };
  }

  const base: string | null = discoveryBaseUrl(connection, env);
  if (base === null) {
    return { unsupported: 'Set a base URL for this connection to discover its models.' };
  }

  const headers: Record<string, string> = { ...(connection.headers ?? {}) };
  if (family === 'anthropic') {
    if (apiKey === null) {
      return { unsupported: 'Add an API key to discover this provider’s models.' };
    }
    headers['x-api-key'] = apiKey;
    headers['anthropic-version'] = '2023-06-01';
  } else if (apiKey !== null) {
    // OpenAI-compatible bearer auth; a local server (Ollama) needs no key.
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  return { url: `${base}/models`, headers };
}

/**
 * Discovers a connection's models and merges them into its existing list. Never throws: a failure to
 * reach or parse the endpoint returns the connection's existing models unchanged with an explanatory
 * detail.
 * @param connection The connection to discover models for.
 * @param apiKey The connection's resolved API key, or null.
 * @param env The environment (for the Ollama default).
 * @param fetchFn The HTTP fetch to use (injected for testing).
 * @returns Returns the discovery result.
 */
export async function runDiscovery(
  connection: AiConnection,
  apiKey: string | null,
  env: Record<string, string | undefined>,
  fetchFn: HttpFetch,
): Promise<AiDiscoverModelsResult> {
  logger.trace('model-discovery', `Discovering models for connection '${connection.id}'`);
  const target: DiscoveryTarget = discoveryTarget(connection, apiKey, env);
  if ('unsupported' in target) {
    logger.debug('model-discovery', `Discovery unsupported: ${target.unsupported}`);
    return { ok: false, models: connection.models, added: 0, detail: target.unsupported };
  }

  let response: HttpResponse;
  try {
    response = await fetchFn(target.url, { headers: target.headers });
  } catch (error: unknown) {
    logger.warn('model-discovery', `Could not reach models endpoint ${target.url}`, error);
    return {
      ok: false,
      models: connection.models,
      added: 0,
      detail: `Could not reach ${target.url}. ${describeRunError(error)}.`,
    };
  }

  if (!response.ok) {
    logger.warn(
      'model-discovery',
      `Models endpoint ${target.url} returned HTTP ${response.status}`,
    );
    return {
      ok: false,
      models: connection.models,
      added: 0,
      detail: `The models endpoint returned HTTP ${response.status}.`,
    };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (error: unknown) {
    logger.warn('model-discovery', `Models endpoint ${target.url} returned invalid JSON`, error);
    return {
      ok: false,
      models: connection.models,
      added: 0,
      detail: 'The models endpoint returned a response that was not valid JSON.',
    };
  }

  const discovered: DiscoveredModel[] = parseModelsResponse(body);
  if (discovered.length === 0) {
    logger.warn('model-discovery', `Models endpoint ${target.url} returned no models`);
    return {
      ok: false,
      models: connection.models,
      added: 0,
      detail: 'The models endpoint returned no models. Add models manually.',
    };
  }

  const merged: AiModelInfo[] = mergeModels(connection.models, discovered);
  const added: number = merged.length - connection.models.length;
  logger.info(
    'model-discovery',
    `Discovery succeeded for '${connection.id}': ${discovered.length} model(s), ${added} new`,
  );
  return {
    ok: true,
    models: merged,
    added,
    detail:
      added > 0
        ? `Found ${discovered.length} models — added ${added} new.`
        : `Found ${discovered.length} models — nothing new.`,
  };
}
