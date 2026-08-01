// Discovers the models a Claude local-login connection offers by asking the Claude Agent SDK what
// models it supports, and merges them into the connection's existing list. The login path has no API
// key, so the HTTP `/v1/models` discovery cannot run — but the SDK reports the account's models over
// its control channel (no turn sent, no key needed). The mapping and merge are pure and unit-testable;
// the single SDK call is injected (the provider passes the real one), so the whole flow is exercised in
// tests with a fake model list.

import type { AiConnection, AiDiscoverModelsResult, AiModelInfo } from '@shared/api/ai-types';
import { describeRunError } from './ai-sdk-stream';
import { resolveContextWindow } from './context-windows';

/**
 * A model as the Claude Agent SDK reports it from `supportedModels()`. Mirrors the SDK's `ModelInfo`
 * for the fields discovery consumes; `resolvedModel` is the concrete id an alias resolves to (for
 * example `opus[1m]` → `claude-opus-5[1m]`).
 */
export interface ClaudeSdkModel {
  /**
   * Gets the identifier the harness accepts for this model (an alias such as `sonnet` or `opus[1m]`,
   * or a concrete id).
   */
  readonly value: string;

  /**
   * Gets the model's human-readable display name.
   */
  readonly displayName: string;

  /**
   * Gets the concrete model id the value resolves to, when the SDK provides one.
   */
  readonly resolvedModel?: string;

  /**
   * Gets the model's description, when the SDK provides one.
   */
  readonly description?: string;
}

/**
 * Parses a bracketed context-window hint from a Claude model id or alias — `opus[1m]`,
 * `claude-opus-5[1m]`, `foo[200k]` — into a token count, or null when none is present.
 * @param id The model id or alias.
 * @returns Returns the token count, or null.
 */
export function parseBracketedContextWindow(id: string): number | null {
  const match: RegExpExecArray | null = /\[(\d+)(m|k)\]/i.exec(id);
  if (match === null) {
    return null;
  }
  const size: number = Number(match[1]);
  return match[2].toLowerCase() === 'm' ? size * 1_000_000 : size * 1_000;
}

/**
 * Resolves a model's context window: the bracketed hint on its alias or resolved id when present,
 * otherwise the heuristic from the resolved (or alias) id.
 * @param model The SDK model.
 * @returns Returns the context window in tokens.
 */
export function claudeContextWindow(model: ClaudeSdkModel): number {
  const fromAlias: number | null = parseBracketedContextWindow(model.value);
  if (fromAlias !== null) {
    return fromAlias;
  }
  const resolved: string = model.resolvedModel ?? model.value;
  const fromResolved: number | null = parseBracketedContextWindow(resolved);
  if (fromResolved !== null) {
    return fromResolved;
  }
  return resolveContextWindow(resolved);
}

/**
 * Capitalises the first letter of a token (`opus` → `Opus`).
 * @param token The token.
 * @returns Returns the capitalised token.
 */
function capitalise(token: string): string {
  return token.length === 0 ? token : `${token[0].toUpperCase()}${token.slice(1)}`;
}

/**
 * Derives a human "Family Version" name from a resolved concrete model id — `claude-opus-5[1m]` →
 * `Opus 5`, `claude-haiku-4-5-20251001` → `Haiku 4.5` — or null when no version can be read (a bare
 * family id, or no resolved id at all). The SDK's ids are aliases that track the latest version, so
 * this is the version the alias resolves to at discovery time (a re-discovery refreshes it).
 * @param resolvedModel The concrete model id an alias resolves to.
 * @returns Returns the versioned family name, or null.
 */
export function resolvedVersionLabel(resolvedModel: string | undefined): string | null {
  if (resolvedModel === undefined || resolvedModel.length === 0) {
    return null;
  }
  const bare: string = resolvedModel
    .replace(/\[[^\]]*\]/g, '') // drop the [1m] context-window suffix
    .replace(/-\d{8}$/, '') // drop a trailing date snapshot
    .replace(/^claude-/, ''); // drop the provider prefix
  const parts: readonly string[] = bare.split('-').filter((part: string): boolean => part.length > 0);
  if (parts.length === 0) {
    return null;
  }
  const family: string = capitalise(parts[0]);
  const version: string = parts.slice(1).join('.');
  return version.length === 0 ? family : `${family} ${version}`;
}

/**
 * Reads the leading "Family Version" token from a model's description — `Opus 4.8 with 1M context` →
 * `Opus 4.8`, `Sonnet 4.6 · Efficient for routine tasks` → `Sonnet 4.6`, `Fable 5 · …` → `Fable 5` —
 * or null when the description does not start with one. This is the version source that works across
 * CLI versions: the SDK-bundled CLI omits `resolvedModel` but always names the version here.
 * @param description The model description.
 * @returns Returns the versioned family name, or null.
 */
export function versionFromDescription(description: string | undefined): string | null {
  if (description === undefined) {
    return null;
  }
  const match: RegExpExecArray | null = /^([A-Za-z]+ \d[\d.]*)/.exec(description.trim());
  return match === null ? null : match[1];
}

/**
 * Builds the picker label for a discovered model: the SDK's family display name with the version folded
 * in — `Sonnet` → `Sonnet 4.6`, `Opus` → `Opus 4.8`, `Default (recommended)` →
 * `Default (recommended) — Opus 4.8`. The version comes from the description (present across CLI
 * versions), falling back to the resolved model id, then to the plain display name.
 * @param model The SDK model.
 * @returns Returns the label.
 */
export function formatClaudeLabel(model: ClaudeSdkModel): string {
  const version: string | null =
    versionFromDescription(model.description) ?? resolvedVersionLabel(model.resolvedModel);
  if (version === null) {
    return model.displayName;
  }
  const family: string = version.split(' ')[0];
  return model.displayName.includes(family)
    ? model.displayName.replace(family, version)
    : `${model.displayName} — ${version}`;
}

/**
 * Maps an SDK model to the app's model info: the SDK's alias `value` is the id the harness accepts, and
 * the label is the family display name with the resolved version folded in (see
 * {@link formatClaudeLabel}).
 * @param model The SDK model.
 * @returns Returns the model info.
 */
export function mapClaudeModel(model: ClaudeSdkModel): AiModelInfo {
  return { id: model.value, label: formatClaudeLabel(model), contextWindow: claudeContextWindow(model) };
}

/**
 * Copies only the user-set flags (pin/hide) from a model — the fields discovery must preserve across a
 * refresh, as distinct from the auto-generated label and context window, which it refreshes.
 * @param model The existing model.
 * @returns Returns the pin/hide flags that are set.
 */
function userFlags(model: AiModelInfo): Pick<AiModelInfo, 'pinned' | 'hidden'> {
  const flags: { pinned?: boolean; hidden?: boolean } = {};
  if (model.pinned !== undefined) {
    flags.pinned = model.pinned;
  }
  if (model.hidden !== undefined) {
    flags.hidden = model.hidden;
  }
  return flags;
}

/**
 * Merges discovered models into the connection's existing list, preserving order: an existing model
 * that is re-discovered has its (auto-generated) label and context window refreshed while its pin/hide
 * flags are kept — so a re-refresh relabels known models rather than leaving stale labels — and each
 * newly-discovered id is appended. Existing models that discovery did not return are left untouched
 * (manual entries survive). Unlike the HTTP merge, the label is refreshed because Claude models carry no
 * user-editable label (there is no rename), so the discovered label is always the better source.
 * @param existing The connection's current models.
 * @param discovered The models mapped from discovery.
 * @returns Returns the merged model list.
 */
export function mergeClaudeModels(
  existing: readonly AiModelInfo[],
  discovered: readonly AiModelInfo[],
): AiModelInfo[] {
  const discoveredById: Map<string, AiModelInfo> = new Map<string, AiModelInfo>(
    discovered.map((model: AiModelInfo): [string, AiModelInfo] => [model.id, model]),
  );
  const seen: Set<string> = new Set<string>();
  const merged: AiModelInfo[] = existing.map((model: AiModelInfo): AiModelInfo => {
    seen.add(model.id);
    const refreshed: AiModelInfo | undefined = discoveredById.get(model.id);
    return refreshed === undefined ? model : { ...refreshed, ...userFlags(model) };
  });
  for (const model of discovered) {
    if (!seen.has(model.id)) {
      merged.push(model);
    }
  }
  return merged;
}

/**
 * Discovers a Claude login connection's models via the SDK and merges them into its existing list.
 * Never throws: a failure to reach the harness returns the connection's existing models unchanged with
 * an explanatory detail.
 * @param connection The Claude login connection.
 * @param listModels Lists the models the SDK reports (spawns the harness in production; injected for
 * testing).
 * @returns Returns the discovery result.
 */
export async function runClaudeDiscovery(
  connection: AiConnection,
  listModels: () => Promise<readonly ClaudeSdkModel[]>,
): Promise<AiDiscoverModelsResult> {
  let discovered: readonly ClaudeSdkModel[];
  try {
    discovered = await listModels();
  } catch (error: unknown) {
    return {
      ok: false,
      models: connection.models,
      added: 0,
      detail: `Could not ask Claude for its models. ${describeRunError(error)}.`,
    };
  }

  if (discovered.length === 0) {
    return {
      ok: false,
      models: connection.models,
      added: 0,
      detail: 'Claude reported no models. Add models manually.',
    };
  }

  const merged: AiModelInfo[] = mergeClaudeModels(connection.models, discovered.map(mapClaudeModel));
  const added: number = merged.length - connection.models.length;
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
