// Shared contract for signing in to an agent provider from inside the app (#1080), platform-neutral
// (types only) so both the Electron back-end and the Angular front-end can import it.
//
// ⛔ Names no provider. The sign-in itself belongs to the plugin that runs the connection, which drives
// its vendor's own login and writes the credential where its runtime reads it. Core shows the window
// and carries what the plugin reports; these types are that report.

import type { AiConnection } from './ai-connection-types';
import type { ClaudeExecutableChoice } from './ai-provider-types';

/**
 * Asks about signing in to the provider that runs a connection.
 */
export interface AiSignInRequest {
  /**
   * Gets the connection whose provider is asked. The whole connection, as discovery sends it: the main
   * process's own map of connections is rebuilt only when the providers are listed, and a sign-in must
   * not depend on that having happened first (#697 was the same trap).
   */
  readonly connection: AiConnection;

  /**
   * Gets which Claude Code CLI a Claude connection signs in with, so sign-in uses the CLI its turns run.
   * Carried as discovery carries it: an application setting with nowhere else to ride.
   */
  readonly claudeExecutable?: ClaudeExecutableChoice;
}

/**
 * Whether the user is signed in to a connection's provider.
 */
export interface AiSignInStatus {
  /**
   * Gets a value indicating whether the provider's plugin can sign anyone in from Studio. False for a
   * plugin that predates it, or one whose vendor has no sign-in of its own.
   */
  readonly supported: boolean;

  /**
   * Gets a value indicating whether the user is signed in. False whenever {@link supported} is.
   */
  readonly signedIn: boolean;

  /**
   * Gets the signed-in account, when the provider says.
   */
  readonly account?: string;
}

/**
 * A phase of a sign-in, streamed from the main process to the sign-in window.
 *
 * - `starting`: the provider's sign-in is starting.
 * - `browser`: the sign-in page is open, or should be; `url` is the page, for a manual open.
 * - `success`: the user is signed in.
 * - `error`: the sign-in failed, was cancelled, or the provider cannot sign in; `message` says why.
 */
export type AiSignInPhase = 'starting' | 'browser' | 'success' | 'error';

/**
 * A progress update for a sign-in (main→renderer).
 */
export interface AiSignInProgress {
  /**
   * Gets the phase this update reports.
   */
  readonly phase: AiSignInPhase;

  /**
   * Gets the sign-in page to open manually, when the provider surfaced one (phase `browser`).
   */
  readonly url?: string;

  /**
   * Gets a short human-readable reason, for the `error` phase.
   */
  readonly message?: string;
}
