// The built-in connections seeded for a fresh install and used as the migration target for users
// upgrading from the old `{provider, models}` settings. Their ids match the old provider ids
// (`claude`, `vercel`, `ollama`) so a user's previous provider and per-provider model choices carry
// over one-to-one onto these connections. This is DATA, not a runtime source of truth — the user may
// relabel, retune, or remove these once the connection-manager UI lands.
//
// NOTE: the model lists here intentionally mirror the main-process catalogues in
// `src/shared/electron/ai/models.ts`. That duplication is transient: a later phase deletes `models.ts`
// as the runtime source of truth and points the adapters at each connection's own list, at which point
// these seeds become the single origin of the bundled catalogue.

import type { AiConnection } from './ai-connection-types';
import type { AiModelInfo } from './ai-provider-types';

/**
 * The Anthropic models seeded for the Claude connections, in display order (most to least capable).
 */
const ANTHROPIC_SEED_MODELS: readonly AiModelInfo[] = [
  { id: 'claude-opus-4-8', label: 'Opus 4.8', contextWindow: 1_000_000 },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6', contextWindow: 1_000_000 },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5', contextWindow: 200_000 },
];

/**
 * The local Ollama models seeded for the Ollama connection, in display order.
 */
const OLLAMA_SEED_MODELS: readonly AiModelInfo[] = [
  { id: 'qwen3:8b', label: 'Qwen3 8B', contextWindow: 40_960 },
  { id: 'qwen2.5-coder:14b', label: 'Qwen2.5 Coder 14B', contextWindow: 32_768 },
  { id: 'qwen2.5-coder:7b', label: 'Qwen2.5 Coder 7B', contextWindow: 32_768 },
];

/**
 * The id of the seeded Claude (local-login) connection — the default active connection.
 */
export const CLAUDE_CONNECTION_ID: string = 'claude';

/**
 * The id of the seeded Anthropic-API-key connection (formerly the "Vercel" provider).
 */
export const ANTHROPIC_KEY_CONNECTION_ID: string = 'vercel';

/**
 * The id of the seeded local Ollama connection.
 */
export const OLLAMA_CONNECTION_ID: string = 'ollama';

/**
 * The id of the connection active by default (the Claude local-login connection).
 */
export const DEFAULT_CONNECTION_ID: string = CLAUDE_CONNECTION_ID;

/**
 * The built-in connections present on a fresh install, mirroring the three providers that existed
 * before connections were user-configurable.
 */
export const SEED_CONNECTIONS: readonly AiConnection[] = [
  {
    id: CLAUDE_CONNECTION_ID,
    kind: 'anthropic',
    label: 'Claude',
    auth: 'claude-login',
    models: ANTHROPIC_SEED_MODELS,
    defaultModelId: 'claude-opus-4-8',
    builtIn: true,
  },
  {
    id: ANTHROPIC_KEY_CONNECTION_ID,
    kind: 'anthropic',
    label: 'Anthropic (API key)',
    auth: 'api-key',
    models: ANTHROPIC_SEED_MODELS,
    defaultModelId: 'claude-opus-4-8',
    builtIn: true,
  },
  {
    id: OLLAMA_CONNECTION_ID,
    kind: 'ollama',
    label: 'Ollama (local)',
    auth: 'none',
    models: OLLAMA_SEED_MODELS,
    defaultModelId: 'qwen3:8b',
    builtIn: true,
  },
];
