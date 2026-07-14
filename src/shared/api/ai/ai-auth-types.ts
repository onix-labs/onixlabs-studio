// Shared AI-agent authentication contract, platform-neutral (types only) so both the Electron
// back-end and the Angular front-end can import it.

import type { AiAuthKind } from './ai-connection-types';

/**
 * Identifies a connection whose credential is being read or changed. Carries the connection's auth
 * kind so the main process picks the right auth strategy without re-reading settings.
 */
export interface AiConnectionAuthRequest {
  /**
   * Gets the id of the connection.
   */
  readonly connectionId: string;

  /**
   * Gets the connection's auth kind.
   */
  readonly authKind: AiAuthKind;
}

/**
 * Requests storing an API key for a connection. The key crosses the bridge once, renderer→main, and is
 * held encrypted in the main process thereafter; it is never read back out.
 */
export interface AiSetConnectionKeyRequest extends AiConnectionAuthRequest {
  /**
   * Gets the API key to store (a blank value clears any stored key).
   */
  readonly key: string;
}

/**
 * Identifies where the agent's Anthropic credentials come from.
 *
 * - `local-login`: the user's local Claude login (`~/.claude`), the same credential Claude Code uses.
 * - `api-key`: a user-supplied API key, stored encrypted at rest, or `ANTHROPIC_API_KEY` in dev.
 * - `none`: no credential is available; the agent cannot run until the user logs in or sets a key.
 */
export type AiAuthSource = 'local-login' | 'api-key' | 'none';

/**
 * Describes the agent's current authentication state, safe to surface in the UI. It never carries the
 * API key itself — the key stays in the main process.
 */
export interface AiAuthStatus {
  /**
   * Gets the resolved credential source.
   */
  readonly source: AiAuthSource;

  /**
   * Gets a value indicating whether a usable credential is available (true unless {@link source} is
   * `none`).
   */
  readonly available: boolean;

  /**
   * Gets a value indicating whether a user-supplied API key is stored (independent of whether it is
   * the active source — a stored key may be shadowed by a local login).
   */
  readonly hasStoredKey: boolean;

  /**
   * Gets a short human-readable description of the current state, suitable for settings UI.
   */
  readonly detail: string;
}
