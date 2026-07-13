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
 * Identifies how much autonomy the agent runs with.
 *
 * - `agent`: the full tool-using agent — read, edit, and execute (subject to the permission posture).
 * - `chat`: a read-only conversational assistant — it may inspect the project and the active surface
 *   but never edits files or runs commands.
 */
export type AgentMode = 'agent' | 'chat';

/**
 * References a file or folder the user attached to the run's context. The path is passed to the run so
 * the agent can read it with its own file tools; the content is not inlined into the prompt.
 */
export interface AgentContextRef {
  /**
   * Gets the absolute path of the attached file or folder.
   */
  readonly path: string;

  /**
   * Gets whether the path refers to a single file or a folder.
   */
  readonly kind: 'file' | 'folder';
}

/**
 * An image attached to a turn (pasted or dropped into the composer), carried as base64 so it crosses
 * the IPC bridge and persists with the transcript.
 */
export interface AiImageRef {
  /**
   * Gets the image's media type (e.g. `image/png`).
   */
  readonly mediaType: string;

  /**
   * Gets the image bytes as base64 (no `data:` prefix).
   */
  readonly data: string;

  /**
   * Gets the source file name, when the image came from a file.
   */
  readonly name?: string;
}

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

  /**
   * Gets how much autonomy the agent runs with. Defaults to `agent` (full tools) when absent; `chat`
   * runs read-only.
   */
  readonly mode?: AgentMode;

  /**
   * Gets the files and folders the user attached to the run's context, referenced by path for the
   * agent to read with its own file tools. Empty or absent when nothing is attached.
   */
  readonly contextPaths?: readonly AgentContextRef[];

  /**
   * Gets the provider session to resume so the model keeps the conversation's prior context, or null/
   * absent to start a fresh session (the first turn of a conversation). Providers that do not support
   * session continuation ignore it.
   */
  readonly resumeSessionId?: string | null;

  /**
   * Gets the provider message to resume up to (and including) when branching a conversation: the
   * resumed session is replayed only to this point, so the discarded turns never reach the model.
   * Used with {@link resumeSessionId} and {@link forkSession}; null/absent to resume the whole
   * session.
   */
  readonly resumeSessionAt?: string | null;

  /**
   * Gets a value indicating whether the resumed session forks to a new session id rather than
   * continuing (a branch keeps the original session untouched, so the original conversation stays
   * resumable). Defaults to false.
   */
  readonly forkSession?: boolean;

  /**
   * Gets the images attached to the turn, sent to the model alongside the prompt. Empty or absent
   * when none are attached.
   */
  readonly images?: readonly AiImageRef[];
}
