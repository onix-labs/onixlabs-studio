// The pluggable authentication seam. Each connection authenticates through an AuthStrategy chosen by
// its AiAuthKind; a strategy turns the resolved credential context (a stored key, whether a local
// Claude login is present, and the development environment key) into the credential a run uses and the
// status the UI shows. This file is deliberately free of Electron and Node imports so the resolution
// logic is unit-testable in isolation — the main-process shell injects the real key store and the
// filesystem checks. An OAuth strategy is a future drop-in: add an implementation and register it in
// {@link AUTH_STRATEGIES}, with no change to callers.

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

  /**
   * Gets a value indicating whether a local Claude login (`~/.claude`) is present.
   */
  readonly hasLocalLogin: boolean;

  /**
   * Gets a value indicating whether a local Codex login (`~/.codex`) is present.
   */
  readonly hasCodexLogin: boolean;

  /**
   * Gets the development-only `ANTHROPIC_API_KEY` environment key, or null when it is unset.
   */
  readonly envKey: string | null;
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
 * The `claude-login` strategy: prefer the user's local Claude login, then a stored key, then the
 * development environment key. This mirrors the precedence the agent used before connections existed,
 * so the built-in Claude connection behaves exactly as the old global credential did.
 */
const CLAUDE_LOGIN_STRATEGY: AuthStrategy = {
  kind: 'claude-login',

  resolve(context: AuthContext): AiCredential {
    if (context.hasLocalLogin) {
      return { source: 'local-login', apiKey: null };
    }
    const key: string | null = context.storedKey ?? context.envKey;
    return key !== null ? { source: 'api-key', apiKey: key } : { source: 'none', apiKey: null };
  },

  status(context: AuthContext): AiAuthStatus {
    const hasStoredKey: boolean = context.storedKey !== null;
    if (context.hasLocalLogin) {
      return {
        source: 'local-login',
        available: true,
        hasStoredKey,
        detail: 'Using your local Claude login (~/.claude).',
      };
    }
    if (hasStoredKey) {
      return {
        source: 'api-key',
        available: true,
        hasStoredKey: true,
        detail: 'Using your stored Anthropic API key.',
      };
    }
    if (context.envKey !== null) {
      return {
        source: 'api-key',
        available: true,
        hasStoredKey: false,
        detail: 'Using ANTHROPIC_API_KEY from the environment.',
      };
    }
    return {
      source: 'none',
      available: false,
      hasStoredKey: false,
      detail: 'Run `claude` to log in, or add an Anthropic API key.',
    };
  },
};

/**
 * The `codex-login` strategy: mirrors `claude-login` for OpenAI Codex — prefers the user's local Codex
 * login (`~/.codex`, the same credential the `codex` CLI uses), falling back to a stored API key.
 */
const CODEX_LOGIN_STRATEGY: AuthStrategy = {
  kind: 'codex-login',

  resolve(context: AuthContext): AiCredential {
    if (context.hasCodexLogin) {
      return { source: 'local-login', apiKey: null };
    }
    // No env fallback here: `envKey` is the Anthropic key, and the Codex runtime picks up its own
    // `OPENAI_API_KEY` from the environment, so only an explicitly stored key is surfaced.
    return context.storedKey !== null
      ? { source: 'api-key', apiKey: context.storedKey }
      : { source: 'none', apiKey: null };
  },

  status(context: AuthContext): AiAuthStatus {
    const hasStoredKey: boolean = context.storedKey !== null;
    if (context.hasCodexLogin) {
      return {
        source: 'local-login',
        available: true,
        hasStoredKey,
        detail: 'Using your local Codex login (~/.codex).',
      };
    }
    if (hasStoredKey) {
      return {
        source: 'api-key',
        available: true,
        hasStoredKey: true,
        detail: 'Using your stored OpenAI API key.',
      };
    }
    return {
      source: 'none',
      available: false,
      hasStoredKey: false,
      detail: 'Run `codex login`, or add an OpenAI API key.',
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
export const AUTH_STRATEGIES: Readonly<Record<AiAuthKind, AuthStrategy>> = {
  'claude-login': CLAUDE_LOGIN_STRATEGY,
  'codex-login': CODEX_LOGIN_STRATEGY,
  'api-key': API_KEY_STRATEGY,
  none: NONE_STRATEGY,
};

/**
 * Returns the strategy for an auth kind.
 * @param kind The auth kind.
 * @returns Returns the matching strategy.
 */
export function strategyFor(kind: AiAuthKind): AuthStrategy {
  return AUTH_STRATEGIES[kind];
}
