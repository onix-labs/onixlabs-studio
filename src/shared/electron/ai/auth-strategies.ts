// The pluggable authentication seam. Each connection authenticates through an AuthStrategy chosen by
// its AiAuthKind; a strategy turns the resolved credential context (a stored key, whether a local
// Claude login is present, and the development environment key) into the credential a run uses and the
// status the UI shows. This file is deliberately free of Electron and Node imports so the resolution
// logic is unit-testable in isolation — the main-process shell injects the real key store and the
// filesystem checks. An OAuth strategy is a future drop-in: add an implementation and register it in
// {@link AUTH_STRATEGIES}, with no change to callers.

import { API_KEY_AUTH, NO_AUTH } from '@shared/api/ai-types';
import type { AiAuthKind, AiAuthSource, AiAuthStatus } from '@shared/api/ai-types';

/**
 * A resolved credential for running an agent turn. The API key, when present, never leaves the main
 * process — it is resolved here and handed directly to the agent SDK.
 */
export interface AiCredential {
  /**
   * Gets the credential source.
   */
  readonly source: AiAuthSource;

  /**
   * Gets the API key to authenticate with, or null when the source is the local login (which
   * authenticates from `~/.claude`) or when no credential is available.
   */
  readonly apiKey: string | null;
}

/**
 * The inputs an {@link AuthStrategy} resolves a credential from: the connection's own stored key, and
 * the two Anthropic-specific fallbacks (a local Claude login and the development environment key).
 */
export interface AuthContext {
  /**
   * Gets the API key stored for the connection, or null when none is stored.
   */
  readonly storedKey: string | null;

  // ⛔ Nothing else. This carried `hasLocalLogin` (`~/.claude`), `hasCodexLogin` (`~/.codex`) and an
  // `ANTHROPIC_API_KEY` environment fallback, so core probed specific providers' login state to phrase
  // settings text for them. A provider's login is its plugin's to know (#653); core holds keys.
}

/**
 * A pluggable authentication strategy. It resolves the credential a run authenticates with and the
 * status the settings UI shows, from the {@link AuthContext}. Implementations must never surface the
 * key in the status (only whether one is stored).
 */
export interface AuthStrategy {
  /**
   * Gets the auth kind this strategy serves.
   */
  readonly kind: AiAuthKind;

  /**
   * Resolves the credential a run authenticates with.
   * @param context The resolution inputs.
   * @returns Returns the resolved credential.
   */
  resolve(context: AuthContext): AiCredential;

  /**
   * Derives the UI-safe authentication status (never carries the key).
   * @param context The resolution inputs.
   * @returns Returns the status.
   */
  status(context: AuthContext): AiAuthStatus;
}

/**
 * The strategy for **any auth kind core does not own** — a provider's own subscription login, a device
 * flow, an OAuth handshake: whatever the plugin does to authenticate itself.
 *
 * ⛔ Core used to carry one of these per provider, reading `~/.claude` and `~/.codex` to decide whether
 * a subscription was signed in and phrasing "Run `claude` to log in" when it was not. That is provider
 * knowledge, it only ever grew, and it meant a new provider could not authenticate any way core had not
 * already been taught (#653). The harness is the thing talking to the provider and is the only thing
 * that can answer — the Claude harness already checks its own login before asking core for a key, so
 * core's copy decided nothing on the run path and only ever coloured the settings text.
 *
 * A stored key still wins if the user set one: an API key is core's to hold whatever the provider is.
 * Otherwise this reports available and says the plugin authenticates, because core cannot know better
 * and a false "not signed in" is worse than a vague "ask the plugin".
 */
const PROVIDER_LOGIN_STRATEGY: AuthStrategy = {
  kind: 'provider-login',

  resolve(context: AuthContext): AiCredential {
    return context.storedKey !== null
      ? { source: 'api-key', apiKey: context.storedKey }
      : { source: 'none', apiKey: null };
  },

  status(context: AuthContext): AiAuthStatus {
    return context.storedKey !== null
      ? {
          source: 'api-key',
          available: true,
          hasStoredKey: true,
          detail: 'Using your stored API key.',
        }
      : {
          source: 'none',
          available: true,
          hasStoredKey: false,
          detail: "Signed in through the provider's plugin.",
        };
  },
};

/**
 * The `api-key` strategy: a connection authenticates solely with its own stored API key (no local
 * login, no environment fallback — those are Anthropic-specific and belong to `claude-login`).
 */
const API_KEY_STRATEGY: AuthStrategy = {
  kind: 'api-key',

  resolve(context: AuthContext): AiCredential {
    return context.storedKey !== null
      ? { source: 'api-key', apiKey: context.storedKey }
      : { source: 'none', apiKey: null };
  },

  status(context: AuthContext): AiAuthStatus {
    const hasStoredKey: boolean = context.storedKey !== null;
    return hasStoredKey
      ? {
          source: 'api-key',
          available: true,
          hasStoredKey: true,
          detail: 'Using your stored API key.',
        }
      : {
          source: 'none',
          available: false,
          hasStoredKey: false,
          detail: 'Add an API key to use this connection.',
        };
  },
};

/**
 * The `none` strategy: the connection needs no credential (for example a local Ollama server), so it
 * is always available.
 */
const NONE_STRATEGY: AuthStrategy = {
  kind: 'none',

  resolve(): AiCredential {
    return { source: 'none', apiKey: null };
  },

  status(): AiAuthStatus {
    return {
      source: 'none',
      available: true,
      hasStoredKey: false,
      detail: 'No credentials required.',
    };
  },
};

/**
 * The registered authentication strategies, keyed by auth kind.
 */
export const AUTH_STRATEGIES: Readonly<Record<string, AuthStrategy>> = {
  [API_KEY_AUTH]: API_KEY_STRATEGY,
  [NO_AUTH]: NONE_STRATEGY,
};

/**
 * Returns the strategy for an auth kind.
 * @param kind The auth kind.
 * @returns Returns the matching strategy.
 */
export function strategyFor(kind: AiAuthKind): AuthStrategy {
  // ⛔ Never index straight into the table now that the kind is open (#653): anything a plugin names
  // lands here, and `undefined.resolve` during a run is the worst possible place to find that out.
  return AUTH_STRATEGIES[kind] ?? PROVIDER_LOGIN_STRATEGY;
}
