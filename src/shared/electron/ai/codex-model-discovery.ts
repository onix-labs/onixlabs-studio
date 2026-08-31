// Discovers the models available to a ChatGPT-backed Codex login from the catalogue maintained by
// the local Codex runtime. A Codex subscription token is not an OpenAI Platform API key, so querying
// `/v1/models` with it returns 401; the runtime cache is the local authority used by the CLI instead.

import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AiConnection, AiDiscoverModelsResult, AiModelInfo } from '@shared/api/ai-types';
import { logger } from '../logger';

/**
 * Reads text from a path. Injected in tests so discovery never depends on the developer's Codex home.
 */
export type TextFileReader = (path: string, encoding: 'utf8') => Promise<string>;

/**
 * Parses the visible models in a Codex `models_cache.json` catalogue.
 * @param json The parsed cache document.
 * @returns Returns models in the runtime's priority order.
 */
export function parseCodexModelsCache(json: unknown): AiModelInfo[] {
  if (typeof json !== 'object' || json === null) {
    return [];
  }
  const entries: unknown = (json as { models?: unknown }).models;
  if (!Array.isArray(entries)) {
    return [];
  }

  const models: AiModelInfo[] = [];
  const seen: Set<string> = new Set<string>();
  for (const entry of entries as unknown[]) {
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }
    const candidate: {
      slug?: unknown;
      display_name?: unknown;
      context_window?: unknown;
      visibility?: unknown;
    } = entry;
    if (
      candidate.visibility !== 'list' ||
      typeof candidate.slug !== 'string' ||
      candidate.slug.length === 0 ||
      seen.has(candidate.slug)
    ) {
      continue;
    }
    seen.add(candidate.slug);
    models.push({
      id: candidate.slug,
      label:
        typeof candidate.display_name === 'string' && candidate.display_name.length > 0
          ? candidate.display_name
          : candidate.slug,
      contextWindow:
        typeof candidate.context_window === 'number' && candidate.context_window > 0
          ? candidate.context_window
          : 32_768,
    });
  }
  return models;
}

/**
 * Reads the local Codex model catalogue for a subscription-backed connection. Never throws; a
 * missing, malformed, or empty cache leaves the existing models intact with a useful explanation.
 * @param connection The Codex-login connection.
 * @param env The process environment, used to honour a custom CODEX_HOME.
 * @param reader The file reader, injected for tests.
 * @returns Returns the discovery result.
 */
export async function runCodexDiscovery(
  connection: AiConnection,
  env: Record<string, string | undefined>,
  reader: TextFileReader = readFile,
): Promise<AiDiscoverModelsResult> {
  const codexHome: string = env['CODEX_HOME'] ?? join(homedir(), '.codex');
  const cachePath: string = join(codexHome, 'models_cache.json');

  let body: string;
  try {
    body = await reader(cachePath, 'utf8');
  } catch (error: unknown) {
    logger.warn('codex-model-discovery', `Could not read ${cachePath}`, error);
    return {
      ok: false,
      models: connection.models,
      added: 0,
      detail: 'The local Codex model catalogue is unavailable. Run Codex once, then refresh.',
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch (error: unknown) {
    logger.warn('codex-model-discovery', `Could not parse ${cachePath}`, error);
    return {
      ok: false,
      models: connection.models,
      added: 0,
      detail: 'The local Codex model catalogue is not valid JSON. Run Codex again, then refresh.',
    };
  }

  const models: AiModelInfo[] = parseCodexModelsCache(parsed);
  if (models.length === 0) {
    return {
      ok: false,
      models: connection.models,
      added: 0,
      detail: 'The local Codex model catalogue contains no visible models.',
    };
  }

  const existingIds: Set<string> = new Set<string>(
    connection.models.map((model): string => model.id),
  );
  const added: number = models.filter((model): boolean => !existingIds.has(model.id)).length;
  logger.info('codex-model-discovery', `Found ${models.length} model(s) in ${cachePath}`);
  return {
    ok: true,
    models,
    added,
    detail: `Found ${models.length} models in the local Codex runtime catalogue.`,
  };
}
