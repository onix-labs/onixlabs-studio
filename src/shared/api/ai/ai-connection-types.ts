// Shared AI-connection contract, platform-neutral (types only) so both the Electron back-end and the
// Angular front-end can import it. A "connection" is the user-configurable unit that replaces the old
// closed provider set: it is pure data describing which back-end to talk to, how to authenticate, and
// which models it offers. The main process turns a connection into a runnable provider by dispatching
// on its {@link AiConnection.kind} to one of a small fixed set of adapters (the Claude Agent SDK for
// `anthropic` with a local login; a generic AI-SDK adapter for everything else).

import type { AiModelInfo } from './ai-provider-types';

/**
 * Identifies the provider family a connection belongs to — `anthropic`, `openai`, `ollama`, or whatever
 * an installed plugin calls its own.
 *
 * ⛔ **Open, not a union (#653).** It was a closed list of the providers core happened to ship, which
 * made it impossible for a plugin to introduce a provider at all: the vocabulary was compiled into the
 * application, so "every provider is a plugin" could never be true while core decided what a provider
 * could be called. The same closed-union trap cost #675 once already, on `connectionAuths`.
 *
 * A kind is an opaque key. Core groups connections by it and asks the plugin catalogue what to call it;
 * a kind no installed plugin claims simply has no page and no agent, which is the honest outcome for a
 * connection whose provider is not installed.
 */
export type AiProviderKind = string;

/**
 * Identifies how a connection authenticates.
 *
 * Core understands exactly two, because they are the only two it can act on by itself:
 *
 * - {@link API_KEY_AUTH} — a user-supplied key, stored encrypted in the main process and keyed by the
 *   connection id. The key never lives in the connection record, nor reaches the renderer.
 * - {@link NO_AUTH} — no credentials at all, for a local endpoint that wants none.
 *
 * ⛔ **Open, not a union (#653).** Anything else — a provider's own subscription login, a device-code
 * flow, an OAuth handshake — is the provider's business and therefore its plugin's. A closed union
 * meant a plugin could not name a kind of its own, so any new authentication method had to be added to
 * core first, which is precisely the coupling this epic exists to remove. Core stores what it is given
 * and asks the plugin to authenticate.
 */
export type AiAuthKind = string;

/**
 * The auth kind for a user-supplied API key, stored encrypted by core.
 */
export const API_KEY_AUTH: string = 'api-key';

/**
 * The auth kind for a connection needing no credentials.
 */
export const NO_AUTH: string = 'none';

/**
 * Describes a single user-configurable provider connection: which back-end to run, how to reach and
 * authenticate it, and which models it offers. This is pure, serialisable data — it is persisted with
 * the user's settings and carries no secret (an `api-key` connection's key is held encrypted in the
 * main process, keyed by {@link id}).
 */
export interface AiConnection {
  /**
   * Gets the identifier of the agent harness plugin that runs this connection, or null/undefined to
   * use the harness Studio compiles in.
   *
   * **Explicit, never inferred.** A harness plugin serves a connection only when that connection names
   * it here — it cannot claim one by declaring an authentication kind. Matching by auth was the first
   * design and it was wrong twice over: `AiAuthKind` is a closed union, so a plugin could not name a
   * kind of its own at all; and if it named an existing one it would silently take every connection of
   * that kind away from the provider Studio ships, which is a capability downgrade the user never asked
   * for (#675).
   *
   * Naming it here inverts that. Nothing changes until somebody points a connection at a plugin, and
   * when they do, they meant to.
   */
  readonly harnessId?: string | null;

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
