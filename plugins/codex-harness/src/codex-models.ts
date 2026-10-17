// The models the Codex CLI offers the signed-in account (#866).
//
// The SDK has no call that lists models, but the CLI keeps the account's list in `models_cache.json`
// under its home, refreshed whenever it runs. That cache is the CLI's own and not a published format,
// so it is read defensively: anything unexpected reads as "no answer", and Studio falls back to the
// models this plugin's manifest lists — never to an error the user has to act on.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { HarnessModel } from './protocol';

/**
 * The cache file, under the Codex home.
 */
const CACHE_FILE: string = 'models_cache.json';

/**
 * Describes what was read.
 */
export interface CodexModels {
  /**
   * Gets the models the account is offered, in the CLI's order.
   */
  readonly models: readonly HarnessModel[];

  /**
   * Gets why there are none, when there are none.
   */
  readonly detail?: string;
}

/**
 * Reads the models the Codex CLI lists for the signed-in account.
 * @param codexHome The Codex home: `$CODEX_HOME`, or `~/.codex`.
 * @returns Returns the models, or none with the reason.
 */
export async function readCodexModels(codexHome: string): Promise<CodexModels> {
  let text: string;
  try {
    text = await readFile(join(codexHome, CACHE_FILE), 'utf8');
  } catch {
    return {
      models: [],
      detail:
        'Codex has not listed its models on this machine yet. Run a Codex turn, then try again.',
    };
  }
  try {
    return { models: parseCodexModels(JSON.parse(text)) };
  } catch {
    return { models: [], detail: "Codex's list of models could not be read." };
  }
}

/**
 * Takes the models from the cache's contents: those the CLI lists for the account — not the ones it
 * hides, which are internal or kept only for compatibility.
 * @param cache The parsed cache.
 * @returns Returns the models.
 */
export function parseCodexModels(cache: unknown): readonly HarnessModel[] {
  const entries: unknown = (cache as { models?: unknown } | null)?.models;
  if (!Array.isArray(entries)) {
    return [];
  }
  const models: HarnessModel[] = [];
  for (const entry of entries as readonly Record<string, unknown>[]) {
    const id: unknown = entry?.['slug'];
    if (typeof id !== 'string' || id.length === 0 || entry['visibility'] !== 'list') {
      continue;
    }
    const label: unknown = entry['display_name'];
    const contextWindow: unknown = entry['context_window'];
    models.push({
      id,
      ...(typeof label === 'string' && label.length > 0 ? { label } : {}),
      ...(typeof contextWindow === 'number' && contextWindow > 0 ? { contextWindow } : {}),
    });
  }
  return models;
}
