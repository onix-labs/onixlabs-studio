// Shared AI model-discovery contract, platform-neutral (types only) so both the Electron back-end and
// the Angular front-end can import it.

import type { AiConnection } from './ai-connection-types';
import type { AiModelInfo, ClaudeExecutableChoice } from './ai-provider-types';

/**
 * Requests discovering the models a connection offers by querying its `/models` endpoint. The whole
 * connection is sent so the main process has its kind, endpoint, and existing models to merge into; the
 * credential is resolved in the main process by connection id (it never crosses the bridge).
 */
export interface AiDiscoverModelsRequest {
  /**
   * Gets the connection to discover models for.
   */
  readonly connection: AiConnection;

  /**
   * Gets which Claude Code CLI to query for a local-login Claude connection (bundled by default). It
   * must match what runs use, so the models discovered are the ones the run harness can actually run.
   */
  readonly claudeExecutable?: ClaudeExecutableChoice;
}

/**
 * The outcome of a model-discovery attempt. On success {@link models} is the connection's model list
 * merged with the newly-discovered ones; on failure it is the connection's existing list unchanged, and
 * {@link detail} explains why (endpoint unsupported, unreachable, or empty).
 */
export interface AiDiscoverModelsResult {
  /**
   * Gets a value indicating whether discovery ran and produced a usable model list.
   */
  readonly ok: boolean;

  /**
   * Gets the resolved model list: the merged list on success, or the existing list unchanged on
   * failure.
   */
  readonly models: readonly AiModelInfo[];

  /**
   * Gets the number of newly-added models (0 on failure or when nothing new was found).
   */
  readonly added: number;

  /**
   * Gets a short human-readable description of the outcome, suitable for the settings UI.
   */
  readonly detail: string;
}
