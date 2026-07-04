// Shared AI-agent run-request contract, platform-neutral (types only) so both the Electron back-end
// and the Angular front-end can import it.

import { AgentSurface } from './ai-tool-surface';
import { AiProviderId } from './ai-provider-types';

/**
 * Identifies how much the agent may do without asking the user first.
 *
 * - `prompt`: ask before every mutating or executing tool (read-only exploration is always allowed).
 * - `auto-edits`: also auto-allow file edits, but still ask before shell/exec tools.
 * - `auto-all`: auto-allow every tool, including shell/exec.
 */
export type AiPermissionPosture = 'prompt' | 'auto-edits' | 'auto-all';

/**
 * Describes a request to run a single agent turn.
 */
export interface AiRunRequest {
  /**
   * Gets the caller-assigned identifier correlating this run with its streamed events.
   */
  readonly requestId: string;

  /**
   * Gets the provider to run the turn through.
   */
  readonly providerId: AiProviderId;

  /**
   * Gets the identifier of the model to run the turn with. The main process falls back to the
   * provider's default model when the value is empty or not one the provider offers.
   */
  readonly model: string;

  /**
   * Gets the user's prompt.
   */
  readonly prompt: string;

  /**
   * Gets the open workspace root the agent should act within, or null for none (the agent then runs
   * against the user's home directory).
   */
  readonly workspaceRoot: string | null;

  /**
   * Gets how much the agent may do without asking the user first.
   */
  readonly permissionPosture: AiPermissionPosture;

  /**
   * Gets the per-request token budget the turn is capped to, or 0 for the provider default (no cap).
   */
  readonly tokenCap: number;

  /**
   * Gets the identifier of the editor tab that owns this run, so the agent's in-app editor tools act
   * on that tab's editor; null when the run has no owning editor (the standalone agent tab).
   */
  readonly owningTabId: string | null;

  /**
   * Gets what this run acts on, which selects the tool set the providers expose. Defaults to
   * `editor` when absent.
   */
  readonly surface?: AgentSurface;
}
