// Shared contract for the in-app Claude login flow, platform-neutral (types only) so both the Electron
// back-end (which drives the `claude` CLI's own OAuth login) and the Angular front-end (which shows the
// "not signed in" modal) can import it. The app never reimplements Anthropic's OAuth: the CLI stays the
// login engine and writes credentials where the Agent SDK later reads them; these types only carry the
// authoritative auth-status answer and the login flow's progress across the bridge.

/**
 * The authoritative answer to "is the user signed in to Claude?", read from `claude auth status`. Used
 * to decide whether a failed agent turn was an expired/absent login (and so should raise the login
 * modal) rather than string-matching a raw error.
 */
export interface ClaudeAuthStatus {
  /**
   * Gets a value indicating whether the user has a valid Claude login.
   */
  readonly loggedIn: boolean;

  /**
   * Gets the signed-in account's email, when known.
   */
  readonly email?: string;
}

/**
 * A phase of the in-app Claude login flow, streamed from the main-process driver to the modal.
 *
 * - `starting`: the login process is spawning.
 * - `browser`: the CLI has launched (the browser should open); `url` carries the sign-in link when the
 *   CLI printed one, for a manual "open sign-in page" fallback.
 * - `success`: the login completed and a valid session now exists.
 * - `error`: the login failed or was cancelled; `message` carries a short reason.
 */
export type ClaudeLoginPhase = 'starting' | 'browser' | 'success' | 'error';

/**
 * A progress update for the in-app Claude login flow (main→renderer).
 */
export interface ClaudeLoginStatus {
  /**
   * Gets the flow phase this update reports.
   */
  readonly phase: ClaudeLoginPhase;

  /**
   * Gets the sign-in URL to open manually, when the CLI surfaced one (phase `browser`).
   */
  readonly url?: string;

  /**
   * Gets a short human-readable reason, for the `error` phase.
   */
  readonly message?: string;
}
