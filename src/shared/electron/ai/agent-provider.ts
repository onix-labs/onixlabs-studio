import type {
  AgentContextRef,
  AgentMode,
  AgentSurface,
  AiEffort,
  AiEvent,
  AiImageRef,
  AiInputChoice,
  AiModelInfo,
  AiPermissionPosture,
  AiRemoteControlMode,
  AiToolPolicy,
  ClaudeExecutableChoice,
} from '@shared/api/ai-types';
import type { AuditGrantSource } from './agent-audit-log';

/**
 * The outcome of an edit-decision round-trip as the provider sees it: apply or don't. The
 * "auto-accept from now on" variant is folded into `yes` by the manager, which records the session
 * flag before settling.
 */
export type EditDecisionOutcome = 'yes' | 'no';

/**
 * Reports whether a provider can currently run, with a reason suitable for display.
 */
export interface ProviderAvailability {
  /**
   * Gets a value indicating whether the provider has what it needs to run.
   */
  readonly available: boolean;

  /**
   * Gets a short human-readable description of the availability.
   */
  readonly detail: string;
}

/**
 * The credential material a provider authenticates a run with. The Claude provider can use either the
 * local login or an API key; API-only providers (e.g. Vercel) require the key.
 */
export interface AgentAuth {
  /**
   * Gets a value indicating whether a local Claude login (`~/.claude`) is present.
   */
  readonly hasLocalLogin: boolean;

  /**
   * Gets a value indicating whether a local Codex login (`~/.codex`) is present.
   */
  readonly hasCodexLogin: boolean;

  /**
   * Gets the available API key, or null when none is available.
   */
  readonly apiKey: string | null;
}

/**
 * Lets a provider invoke an in-app capability that lives in the renderer (read/write the live editor,
 * etc.) during a run.
 */
export interface AgentBridge {
  /**
   * Invokes an in-app capability and resolves with its result.
   * @param capability The capability name.
   * @param input The capability input.
   * @param timeoutMs An optional reply timeout (ms) overriding the bridge default, for a capability
   * that legitimately runs longer than a normal request (e.g. running a file and awaiting its exit).
   * @returns Returns the capability's result.
   */
  request(capability: string, input: unknown, timeoutMs?: number): Promise<unknown>;
}

/**
 * The context for a single agent run: the prompt and scope, the resolved credential, an abort signal,
 * the in-app capability bridge, the permission prompt, and the sink that streams provider-agnostic
 * events back to the renderer.
 */
export interface AgentRunContext {
  /**
   * Gets the identifier correlating this run with its streamed events.
   */
  readonly requestId: string;

  /**
   * Gets the user's prompt.
   */
  readonly prompt: string;

  /**
   * Gets the workspace root the agent should act within, or null for none.
   */
  readonly workspaceRoot: string | null;

  /**
   * Gets the identifier of the model to run the turn with (already resolved to one the provider
   * offers).
   */
  readonly model: string;

  /**
   * Gets the stable identifier of the agent conversation this run belongs to (#327), or null when the
   * run has none. Used to correlate session-level events (e.g. discovered commands) to the conversation
   * independently of the per-turn request id.
   */
  readonly agentSessionId: string | null;

  /**
   * Gets the reasoning-effort level to run the turn at (already clamped to one the provider supports),
   * or null to use the provider default.
   */
  readonly effort: AiEffort | null;

  /**
   * Gets how the session should be exposed via the provider's Remote Control feature (#331). `off`
   * unless the run requested otherwise and the provider supports it. Providers that do not support
   * remote control ignore it.
   */
  readonly remoteControl: AiRemoteControlMode;

  /**
   * Gets how much the agent may do without asking the user first.
   */
  readonly permissionPosture: AiPermissionPosture;

  /**
   * Gets the user's default allow/ask/deny decision per gateable tool, keyed by display name (#309).
   * The gate consults it ahead of the prompt: `deny` refuses even under an auto-allowing posture,
   * `allow` skips the prompt, and a missing entry preserves the posture-driven default. Never empty
   * of meaning — an absent key means "ask".
   */
  readonly toolPolicies: Readonly<Record<string, AiToolPolicy>>;

  /**
   * Gets extra absolute directories the agent may write to beyond the workspace root (#310). Empty
   * when the user configured none.
   */
  readonly allowedWritePaths: readonly string[];

  /**
   * Gets paths the agent may never write to, even inside an allowed root (#310): absolute paths or
   * bare path segments. Empty when the user configured none.
   */
  readonly deniedWritePaths: readonly string[];

  /**
   * Gets the per-request token budget the turn is capped to, or 0 for no cap.
   */
  readonly tokenCap: number;

  /**
   * Gets the absolute path of the shell whose login profile the agent's environment is sourced from
   * (#318), or null to inherit the process environment (already hydrated from the default login shell
   * at startup, #317). Lets the agent's Bash use a different shell's `PATH`/exports than the
   * interactive default.
   */
  readonly agentShell: string | null;

  /**
   * Gets which Claude Code CLI the harness spawns for this run. Only the Claude local-login provider
   * reads it; other providers do not spawn a CLI.
   */
  readonly claudeExecutable: ClaudeExecutableChoice;

  /**
   * Gets the identifier of the editor tab that owns this run, so the in-app editor tools act on that
   * tab's editor; null when the run has no owning editor (the standalone agent tab).
   */
  readonly owningTabId: string | null;

  /**
   * Gets what this run acts on, which selects the tool set the providers expose: the open editor
   * document (`editor`) or the owning terminal (`terminal`).
   */
  readonly surface: AgentSurface;

  /**
   * Gets how much autonomy the agent runs with: `agent` (full tools) or `chat` (read-only — it may
   * inspect but never edits or executes).
   */
  readonly mode: AgentMode;

  /**
   * Gets the files and folders the user attached to the run's context, referenced by path for the
   * agent to read with its own file tools. Empty when nothing is attached.
   */
  readonly contextPaths: readonly AgentContextRef[];

  /**
   * Gets the images attached to the turn, sent to the model alongside the prompt. Empty when none
   * are attached (and always empty for providers that report no image support).
   */
  readonly images: readonly AiImageRef[];

  /**
   * Gets the provider session to resume so the model keeps the conversation's prior context, or null
   * to start a fresh session (a conversation's first turn). Providers that do not support session
   * continuation ignore it.
   */
  readonly resumeSessionId: string | null;

  /**
   * Gets the provider message to resume up to (and including) when branching a conversation, or null
   * to resume the whole session. Used with {@link resumeSessionId} and {@link forkSession}.
   */
  readonly resumeSessionAt: string | null;

  /**
   * Gets a value indicating whether the resumed session forks to a new session id rather than
   * continuing, so a branch leaves the original session untouched.
   */
  readonly forkSession: boolean;

  /**
   * Gets the credential the run authenticates with.
   */
  readonly auth: AgentAuth;

  /**
   * Gets the signal that aborts the run when the user stops it.
   */
  readonly signal: AbortSignal;

  /**
   * Gets the bridge to the renderer's in-app capabilities.
   */
  readonly bridge: AgentBridge;

  /**
   * Asks the user to permit a gated action, resolving once they answer (or false if the run aborts).
   * @param name The display name of the action requesting permission.
   * @param detail A one-line summary of what the action will do.
   * @param cancel An optional signal that dismisses the local prompt and resolves false when aborted —
   *   used when a remote peer answers the same permission first, so Studio's prompt clears.
   * @returns Returns true when the user grants permission.
   */
  requestPermission(name: string, detail: string, cancel?: AbortSignal): Promise<boolean>;

  /**
   * Records an executed mutating/exec action to the audit log (#308/#311). Called at the execution
   * point — the Claude `PostToolUse` hook and the AI-SDK `gated` wrapper — so classifier-auto-run
   * commands are captured, not only gated ones; denials never reach here. Read-only and in-app tools
   * must not be reported.
   * @param name The tool's display name.
   * @param detail A one-line summary of what the action targets.
   * @param source The coarse reason the action was allowed.
   */
  recordAudit(name: string, detail: string, source: AuditGrantSource): void;

  /**
   * Asks the user a question on the agent's behalf, resolving once they answer (or null when they
   * decline or the run aborts). The provider blocks on the answer exactly as it blocks on a
   * permission decision.
   * @param question The question the agent is asking.
   * @param choices The suggested answers, or empty for a free-form question.
   * @param cancel An optional signal that dismisses the local prompt and resolves null when aborted —
   *   used when a remote peer answers the same question first, so Studio's prompt clears.
   * @returns Returns the user's answer, or null when they declined.
   */
  requestInput(
    question: string,
    choices: readonly AiInputChoice[],
    cancel?: AbortSignal,
  ): Promise<string | null>;

  /**
   * Asks the user to decide on a staged edit preview (showing as a diff in the document well for
   * code targets), resolving once they apply or reject it — or immediately with `yes` when edits are
   * being auto-accepted for the session. Resolves `no` if the run aborts first.
   * @param name The display name of the document being edited.
   * @param detail A one-line summary of the staged change.
   * @param hasDiff Whether the staged change is showing as a diff in the document well.
   * @returns Returns the decision.
   */
  requestEditDecision(name: string, detail: string, hasDiff: boolean): Promise<EditDecisionOutcome>;

  /**
   * Emits a streamed event for this run.
   * @param event The event to emit (its `requestId` must match this run).
   */
  emit(event: AiEvent): void;

  /**
   * Registers (or clears, with null) the run's mid-run steering handler. A provider that supports
   * streaming input registers a handler that takes an injected user message and returns whether the
   * run accepted it; while no handler is registered, steer requests for this run are refused and the
   * renderer queues the message for after the run instead.
   * @param handler The handler, or null to stop accepting steered messages.
   */
  setSteerHandler(handler: ((text: string) => boolean) | null): void;
}

/**
 * How a provider maintains a conversation, which decides whether it can hold a live session (#324):
 *
 * - `live-harness`: an external agentic runtime (Claude Code, OpenAI Codex) driven as a subprocess that
 *   owns its own loop and tools and can keep a session open across turns.
 * - `stateless`: a raw model endpoint (via the Vercel AI SDK) where Studio owns the loop and the
 *   "session" is the replayed transcript — nothing is held open between turns.
 */
export type AgentSessionModel = 'live-harness' | 'stateless';

/**
 * A provider's live conversation session for one agent, held open across turns (#324; live-harness
 * providers only). This is the **target contract implemented in P3 (#327)** — it is declared here so the
 * seam is fixed, but is **not yet wired at runtime**: today's per-turn {@link AgentProvider.run} still
 * drives every provider. A stateless provider satisfies it trivially (each {@link turn} is one call).
 */
export interface AgentSession {
  /**
   * Gets the provider session id once known (from the first turn's `session` event), or null before.
   */
  readonly id: string | null;

  /**
   * Gets a value indicating whether the session can still take a turn. It goes false when the session is
   * closed, or when its held-open harness has ended underneath it (the subprocess exited, the message
   * stream closed) — a state a caller cannot otherwise see. A turn dispatched to a session that is no
   * longer alive would never settle (nothing remains to stream its events or resolve it), leaving the
   * conversation stuck "Working" forever, so the manager checks this before reusing a held-open session
   * and reopens a fresh one instead when it reads false.
   */
  readonly alive: boolean;

  /**
   * Runs a turn in this session, streaming events through the context until the turn settles and leaving
   * the session open for the next turn.
   * @param context The turn's context.
   */
  turn(context: AgentRunContext): Promise<void>;

  /**
   * Interrupts the in-flight turn, leaving the session open for the next turn (maps to the harness's
   * interrupt — distinct from {@link close}).
   */
  interrupt(): void;

  /**
   * Ends the session and releases its resources (the harness subprocess).
   */
  close(): Promise<void>;
}

/**
 * A provider-agnostic agent implementation. Concrete providers (Claude Agent SDK, Vercel AI SDK) wrap
 * their own SDK behind this seam and parse their output into the shared {@link AiEvent} protocol.
 */
export interface AgentProvider {
  /**
   * Gets the provider's stable identifier — the id of the connection it serves.
   */
  readonly id: string;

  /**
   * Gets the provider's human-readable label.
   */
  readonly label: string;

  /**
   * Gets the models the provider can run a turn with, in display order.
   */
  readonly models: readonly AiModelInfo[];

  /**
   * Gets the identifier of the provider's default model (always present in {@link models}).
   */
  readonly defaultModelId: string;

  /**
   * Gets a value indicating whether the provider accepts image input on a turn.
   */
  readonly supportsImages: boolean;

  /**
   * Gets the reasoning-effort levels the provider offers (least to most), or empty when it has none
   * selectable. Surfaced to the renderer so the `/effort` command gates and offers the right levels.
   */
  readonly supportedEfforts: readonly AiEffort[];

  /**
   * Gets a value indicating whether the provider can expose a session to another machine via its own
   * Remote Control feature (#331). Surfaced to the renderer so the remote-control control is offered
   * only where it works.
   */
  readonly supportsRemoteControl: boolean;

  /**
   * Gets how the provider maintains a conversation — whether it can hold a live session (#324).
   * `live-harness` providers will open an {@link AgentSession}; `stateless` providers run per-turn. This
   * is a classification only in P2 (#326); the live-session runtime lands in P3 (#327).
   */
  readonly sessionModel: AgentSessionModel;

  /**
   * Reports whether the provider can run with the given credential.
   * @param auth The resolved credential material.
   * @returns Returns the availability descriptor.
   */
  describeAvailability(auth: AgentAuth): ProviderAvailability;

  /**
   * Runs a single agent turn, streaming events through the context until the turn ends or aborts.
   * @param context The run context.
   */
  run(context: AgentRunContext): Promise<void>;

  /**
   * Opens a live session for one agent, held open across turns (#324/#327). Only `live-harness`
   * providers implement this; `stateless` providers omit it and run per-turn through {@link run}. The
   * runtime wiring lands in P3 — the transient {@link run} path stays the default until then.
   * @param context The context of the turn the session opens for.
   * @returns Returns the live session.
   */
  openSession?(context: AgentRunContext): AgentSession;
}
