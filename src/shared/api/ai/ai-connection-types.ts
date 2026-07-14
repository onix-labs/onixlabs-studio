// Shared AI-connection contract, platform-neutral (types only) so both the Electron back-end and the
// Angular front-end can import it. A "connection" is the user-configurable unit that replaces the old
// closed provider set: it is pure data describing which back-end to talk to, how to authenticate, and
// which models it offers. The main process turns a connection into a runnable provider by dispatching
// on its {@link AiConnection.kind} to one of a small fixed set of adapters (the Claude Agent SDK for
// `anthropic` with a local login; a generic AI-SDK adapter for everything else).

import type { AiModelInfo } from './ai-provider-types';

/**
 * Identifies the adapter family a connection runs through, which selects how the app talks to it. All
 * kinds except `anthropic` (which can use the Claude Agent SDK and the local login) are served by the
 * generic AI-SDK adapter; `openai-compatible` and `custom` additionally require a {@link
 * AiConnection.baseUrl}, letting a user point at any OpenAI-compatible endpoint (a self-hosted gateway,
 * GLM, DeepSeek, and so on) with no code change.
 */
export type AiProviderKind =
  | 'anthropic'
  | 'openai'
  | 'xai'
  | 'google'
  | 'deepseek'
  | 'ollama'
  | 'openai-compatible'
  | 'custom';

/**
 * Identifies how a connection authenticates.
 *
 * - `api-key`: a user-supplied API key, stored encrypted in the main process and keyed by the
 *   connection id (the key never lives in this record, nor reaches the renderer).
 * - `none`: no credentials (for example a local Ollama server).
 * - `claude-login`: reuse the user's local Claude login (`~/.claude`), the Claude Agent SDK path.
 *
 * An OAuth strategy is a deliberate future addition (the credential layer is built as a pluggable seam
 * so it slots in without reworking connections).
 */
export type AiAuthKind = 'api-key' | 'none' | 'claude-login';

/**
 * Describes a single user-configurable provider connection: which back-end to run, how to reach and
 * authenticate it, and which models it offers. This is pure, serialisable data — it is persisted with
 * the user's settings and carries no secret (an `api-key` connection's key is held encrypted in the
 * main process, keyed by {@link id}).
 */
export interface AiConnection {
  /**
   * Gets the connection's stable identifier, unique within the user's connection list. It keys the
   * connection's stored credential and its remembered model selection, so it must not change once set.
   */
  readonly id: string;

  /**
   * Gets the adapter family the connection runs through.
   */
  readonly kind: AiProviderKind;

  /**
   * Gets the connection's human-readable label (shown in the provider picker and settings).
   */
  readonly label: string;

  /**
   * Gets the base URL of the connection's API endpoint, for kinds that need one (`openai-compatible`
   * and `custom`, and optionally to override a hosted kind's default). Absent uses the kind's default
   * endpoint.
   */
  readonly baseUrl?: string;

  /**
   * Gets extra HTTP headers sent with every request to the connection's endpoint (for gateways that
   * require them). Absent sends none.
   */
  readonly headers?: Readonly<Record<string, string>>;

  /**
   * Gets how the connection authenticates.
   */
  readonly auth: AiAuthKind;

  /**
   * Gets the models the connection can run a turn with, in display order. Populated by discovery or by
   * the user; seeded connections ship with a starting set.
   */
  readonly models: readonly AiModelInfo[];

  /**
   * Gets the identifier of the connection's default model (used when the user has not picked one).
   */
  readonly defaultModelId: string;
}
