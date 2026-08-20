// Shared AI-agent run-request contract, platform-neutral (types only) so both the Electron back-end
// and the Angular front-end can import it.

import { AgentSurface } from './ai-tool-surface';
import {
  AiEffort,
  AiProviderId,
  AiRemoteControlMode,
  ClaudeExecutableChoice,
} from './ai-provider-types';

/**
 * Identifies how much the agent may do without asking the user first.
 *
 * - `prompt`: ask before every mutating or executing tool (read-only exploration is always allowed).
 * - `auto-edits`: also auto-allow file edits, but still ask before shell/exec tools.
 * - `auto-all`: auto-allow every tool, including shell/exec.
 */
export type AiPermissionPosture = 'prompt' | 'auto-edits' | 'auto-all';

/**
 * A user's default decision for a single gateable tool, consulted by the permission gate ahead of the
 * interactive prompt (#309).
 *
 * - `allow`: run the tool without prompting (still subject to the non-overridable write confinement).
 * - `ask`: the default — preserve today's behaviour (posture decides, otherwise prompt).
 * - `deny`: refuse the tool outright, even when the posture would auto-allow it.
 */
export type AiToolPolicy = 'allow' | 'ask' | 'deny';

/**
 * Identifies how much autonomy the agent runs with.
 *
 * - `agent`: the full tool-using agent — read, edit, and execute (subject to the permission posture).
 * - `chat`: a read-only conversational assistant — it may inspect the project and the active surface
 *   but never edits files or runs commands.
 */
export type AgentMode = 'agent' | 'chat';

/**
 * References a file, folder, or editor selection the user attached to the run's context. A file or
 * folder is passed by path so the agent reads it with its own file tools; a selection carries its
 * text, inlined into the prompt (so it reaches every provider, including those without file tools).
 */
export interface AgentContextRef {
  /**
   * Gets the absolute path of an attached file or folder, or the display label of a selection.
   */
  readonly path: string;

  /**
   * Gets what the reference is: a file or folder (read by path) or an editor selection (inlined).
   */
  readonly kind: 'file' | 'folder' | 'selection';

  /**
   * Gets the selected text of a selection reference (absent for files and folders).
   */
  readonly content?: string;
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
   * Gets the caller-assigned, stable identifier of the agent conversation this turn belongs to (#327).
   * A live-harness provider routes turns that share an `agentSessionId` into the same held-open session;
   * absent/empty falls back to the transient per-turn path. Distinct from {@link resumeSessionId} (the
   * provider's own session id, used for cold-start resume).
   */
  readonly agentSessionId?: string;

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
   * Gets the user's default allow/ask/deny decision per gateable tool, keyed by the tool's display
   * name (#309). Consulted by the permission gate ahead of the prompt: `deny` refuses even when the
   * posture would auto-allow; `allow` skips the prompt; a missing entry (or `ask`) preserves today's
   * posture-driven behaviour. Absent or empty when the user has set no policies.
   */
  readonly toolPolicies?: Readonly<Record<string, AiToolPolicy>>;

  /**
   * Gets extra directories the agent may write to beyond the workspace root (#310), as absolute
   * paths. They widen the write-confinement boundary and are granted to the agent's tools (and the
   * Bash sandbox). Absent or empty when the user has configured none.
   */
  readonly allowedWritePaths?: readonly string[];

  /**
   * Gets paths the agent may never write to, even inside the workspace root or an allowed directory
   * (#310): an absolute path (blocks it and anything beneath) or a bare path segment (blocks any path
   * containing that segment, e.g. `.git`, `.env`). Absent or empty when the user has configured none.
   */
  readonly deniedWritePaths?: readonly string[];

  /**
   * Gets the hosts the agent may reach, as host patterns (`api.example.com`, `*.corp.example`).
   * Empty or absent allows any host, which is how Studio behaved before the setting existed.
   */
  readonly allowedNetworkLocations?: readonly string[];

  /**
   * Gets the hosts the agent may never reach, even when {@link allowedNetworkLocations} would permit
   * them. Absent or empty when the user has configured none.
   */
  readonly deniedNetworkLocations?: readonly string[];

  /**
   * Gets the per-request token budget the turn is capped to, or 0 for the provider default (no cap).
   */
  readonly tokenCap: number;

  /**
   * Gets the absolute path of the shell whose login profile the agent's Bash environment is sourced
   * from (#318), or absent/empty to inherit the process environment (hydrated from the default login
   * shell at startup, #317). Only an absolute path is honoured; anything else falls back to the
   * inherited environment.
   */
  readonly agentShell?: string;

  /**
   * Gets which Claude Code CLI the harness spawns (Claude local-login provider only); absent means the
   * bundled CLI.
   */
  readonly claudeExecutable?: ClaudeExecutableChoice;

  /**
   * Gets the wall-clock budget the run is aborted after, in milliseconds, or 0 for no limit. The
   * clock pauses while the run is blocked on the user (a permission, question, or edit decision).
   */
  readonly runTimeoutMs?: number;

  /**
   * Gets how long (in milliseconds) the agent's held-open live session may sit idle before it is reaped
   * to free its background process (#328), or 0 to never reap on idle. A reaped session reopens
   * transparently (via resume) on the next turn. Carried on every turn so a live session tracks the
   * current setting; ignored by the transient (stateless) path.
   */
  readonly agentSessionLifetimeMs?: number;

  /**
   * Gets the reasoning-effort level to run at (#330), or absent for the provider default. Honoured only
   * when the resolved provider declares it in `supportedEfforts`; ignored otherwise.
   */
  readonly effort?: AiEffort;

  /**
   * Gets how the session should be exposed via the provider's Remote Control feature (#331), or absent
   * for `off`. Honoured only when the resolved provider declares `supportsRemoteControl`; ignored
   * otherwise.
   */
  readonly remoteControl?: AiRemoteControlMode;

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
