// Shared AI-agent contract between the Electron (back-end) and Angular (front-end) processes.
// Keep this module platform-neutral (types only — no Node or DOM dependencies) so both
// compilation targets can import it.

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

/**
 * Reports the outcome of an end-to-end authentication check (a minimal real agent turn).
 */
export interface AiVerifyResult {
  /**
   * Gets a value indicating whether the agent authenticated and produced a response.
   */
  readonly ok: boolean;

  /**
   * Gets a short human-readable description of the outcome.
   */
  readonly detail: string;
}

/**
 * Defines the AI-agent operations exposed to the renderer process. The API key is never exposed
 * through this surface — only narrow status, configuration, and verification calls cross the bridge.
 */
export interface AiApi {
  /**
   * Gets the current authentication status.
   * @returns Returns the resolved {@link AiAuthStatus}.
   */
  getAuthStatus(): Promise<AiAuthStatus>;

  /**
   * Stores a user-supplied API key, encrypted at rest, and returns the updated status.
   * @param key The Anthropic API key to store.
   * @returns Returns the updated {@link AiAuthStatus}.
   */
  setApiKey(key: string): Promise<AiAuthStatus>;

  /**
   * Clears any stored API key and returns the updated status.
   * @returns Returns the updated {@link AiAuthStatus}.
   */
  clearApiKey(): Promise<AiAuthStatus>;

  /**
   * Runs a minimal agent turn to confirm the resolved credential authenticates end-to-end.
   * @returns Returns the {@link AiVerifyResult}.
   */
  verifyAuthentication(): Promise<AiVerifyResult>;
}
