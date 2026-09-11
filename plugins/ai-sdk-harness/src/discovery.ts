// Asking a connection's endpoint what models it can run.
//
// This is the half of #653 that only a harness can do. `AiManager.discoverModels` used to branch on the
// connection's *auth kind* to decide which vendor to talk to — the last place core read a vendor's
// identity to decide what to do — so a provider that arrived as a plugin could only ever offer models
// somebody typed in by hand. A harness answers for itself.
//
// ⚠️ Reproduced from `model-discovery.ts` rather than imported, on the plugin's rule. What is *not*
// reproduced is the merge: core resolves each model's context window and merges the list into the
// connection's own, because those are facts about a model rather than about the harness running it.

import {
  clientFamily,
  DISCOVERY_BASE_URLS,
  resolveOllamaBaseUrl,
  type ClientFamily,
} from './endpoint';
import { describeRunError } from './events';
import type { HarnessModel, ProviderSettings } from './protocol';

/**
 * The endpoint and headers a discovery request is made with, or the reason it cannot run.
 */
export type DiscoveryTarget =
  | { readonly url: string; readonly headers: Record<string, string> }
  | { readonly unsupported: string };

/**
 * What a discovery found, and — when it found nothing — why.
 */
export interface DiscoveryReport {
  /**
   * Gets the models the endpoint reported, which may be empty.
   */
  readonly models: readonly HarnessModel[];

  /**
   * Gets why the list is empty, or null when it is not.
   */
  readonly detail: string | null;
}

/**
 * Parses an OpenAI/Anthropic-style `{ data: [{ id, display_name? }] }` models response, ignoring
 * malformed entries.
 * @param json The parsed response body.
 * @returns Returns the discovered models.
 */
export function parseModelsResponse(json: unknown): HarnessModel[] {
  if (typeof json !== 'object' || json === null) {
    return [];
  }
  const data: unknown = (json as { data?: unknown }).data;
  if (!Array.isArray(data)) {
    return [];
  }
  const models: HarnessModel[] = [];
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
 * Resolves the base URL a connection's models are discovered from, or null when its kind has no
 * discoverable endpoint and no base URL was set.
 * @param settings The connection's settings.
 * @param env The environment, for the Ollama default.
 * @returns Returns the base URL, or null.
 */
function discoveryBaseUrl(
  settings: ProviderSettings,
  env: Record<string, string | undefined>,
): string | null {
  if (settings.baseUrl !== null && settings.baseUrl.length > 0) {
    return settings.baseUrl.replace(/\/+$/, '');
  }
  if (settings.connectionKind === 'ollama') {
    return resolveOllamaBaseUrl(env);
  }
  return DISCOVERY_BASE_URLS[settings.connectionKind] ?? null;
}

/**
 * Resolves the discovery endpoint and headers for a connection, or the reason discovery cannot run.
 * @param settings The connection's settings.
 * @param apiKey The connection's API key, or null when it has none.
 * @param env The environment, for the Ollama default.
 * @returns Returns the discovery target.
 */
export function discoveryTarget(
  settings: ProviderSettings,
  apiKey: string | null,
  env: Record<string, string | undefined>,
): DiscoveryTarget {
  const family: ClientFamily = clientFamily(settings.connectionKind);
  if (family === 'google') {
    return {
      unsupported: 'This provider does not support automatic model discovery. Add models manually.',
    };
  }

  const base: string | null = discoveryBaseUrl(settings, env);
  if (base === null) {
    return { unsupported: 'Set a base URL for this connection to discover its models.' };
  }

  const headers: Record<string, string> = { ...settings.headers };
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
 * Asks a connection's endpoint what models it offers.
 *
 * **Never throws.** Every failure comes back as an empty list with a sentence naming what to go and fix:
 * an unreachable local server, a gateway answering 403 and an endpoint returning something that is not
 * JSON are three different problems, and "no models" is not a reason for any of them.
 * @param settings The connection's settings.
 * @param apiKey The connection's API key, or null when it has none.
 * @param env The environment, for the Ollama default.
 * @returns Returns the report.
 */
export async function discoverModels(
  settings: ProviderSettings,
  apiKey: string | null,
  env: Record<string, string | undefined>,
): Promise<DiscoveryReport> {
  const target: DiscoveryTarget = discoveryTarget(settings, apiKey, env);
  if ('unsupported' in target) {
    return { models: [], detail: target.unsupported };
  }

  let response: Response;
  try {
    response = await fetch(target.url, { headers: target.headers });
  } catch (error: unknown) {
    return { models: [], detail: `Could not reach ${target.url}. ${describeRunError(error)}.` };
  }

  if (!response.ok) {
    return { models: [], detail: `The models endpoint returned HTTP ${response.status}.` };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return {
      models: [],
      detail: 'The models endpoint returned a response that was not valid JSON.',
    };
  }

  const models: readonly HarnessModel[] = parseModelsResponse(body);
  return models.length === 0
    ? { models: [], detail: 'The models endpoint returned no models. Add models manually.' }
    : { models, detail: null };
}
