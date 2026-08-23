// Shared AI-agent streamed-event protocol, platform-neutral (types only) so both the Electron
// back-end and the Angular front-end can import it.

/**
 * Identifies the lifecycle state carried by a {@link AiStatusEvent}.
 */
export type AiRunState = 'started' | 'completed' | 'aborted' | 'error';

/**
 * The fields every streamed agent event carries.
 */
export interface AiEventBase {
  /**
   * Gets the identifier of the run the event belongs to.
   */
  readonly requestId: string;

  /**
   * Gets the identifier of the sub-agent this event belongs to — the `toolId` of the Task tool use
   * that spawned it — so nested work can be attributed and rendered under its own lane. Absent for
   * the run's own top-level events.
   */
  readonly parentToolId?: string;
}

/**
 * A chunk of assistant text.
 */
export interface AiTextEvent extends AiEventBase {
  /**
   * Gets the discriminator.
   */
  readonly kind: 'text';

  /**
   * Gets the text chunk.
   */
  readonly delta: string;

  /**
   * Gets the provider's identifier for the assistant message this chunk belongs to, when the
   * provider assigns one (the Claude Agent SDK's message uuid). It anchors conversation branching:
   * a rewound conversation forks its session resumed up to this message.
   */
  readonly messageUuid?: string;
}

/**
 * A chunk of assistant reasoning.
 */
export interface AiThinkingEvent extends AiEventBase {
  /**
   * Gets the discriminator.
   */
  readonly kind: 'thinking';

  /**
   * Gets the reasoning chunk.
   */
  readonly delta: string;
}

/**
 * Signals that the agent began using a tool.
 */
export interface AiToolStartEvent extends AiEventBase {
  /**
   * Gets the discriminator.
   */
  readonly kind: 'tool-start';

  /**
   * Gets the identifier correlating this tool use with its completion.
   */
  readonly toolId: string;

  /**
   * Gets the tool's display name.
   */
  readonly name: string;

  /**
   * Gets a one-line summary of the tool's input.
   */
  readonly detail: string;

  /**
   * Gets the tool's full input, pretty-printed (JSON), for the transcript's expandable raw-detail
   * view. Clamped at the source with an explicit truncation marker when enormous; undefined when the
   * tool takes no input.
   */
  readonly input?: string;

  /**
   * Gets the type of the sub-agent this tool use spawns (a Task tool's `subagent_type`, e.g.
   * `Explore`), or undefined for an ordinary tool. Events from inside the sub-agent carry this tool
   * use's {@link toolId} as their `parentToolId`.
   */
  readonly agentType?: string;
}

/**
 * Signals that a tool use completed.
 */
export interface AiToolEndEvent extends AiEventBase {
  /**
   * Gets the discriminator.
   */
  readonly kind: 'tool-end';

  /**
   * Gets the identifier of the tool use that completed.
   */
  readonly toolId: string;

  /**
   * Gets a value indicating whether the tool succeeded.
   */
  readonly ok: boolean;

  /**
   * Gets a one-line summary of the result.
   */
  readonly detail: string;

  /**
   * Gets the tool's raw output — or the error detail when it failed — for the transcript's
   * expandable raw-detail view. Clamped at the source with an explicit truncation marker when
   * enormous; undefined when the tool produced none.
   */
  readonly output?: string;
}

/**
 * Requests the user's decision before a gated tool runs. Emitted once the permission broker lands
 * (#113); defined here so the event protocol is stable.
 */
export interface AiPermissionEvent extends AiEventBase {
  /**
   * Gets the discriminator.
   */
  readonly kind: 'permission';

  /**
   * Gets the identifier the renderer answers the request with.
   */
  readonly permissionId: string;

  /**
   * Gets the display name of the tool requesting permission.
   */
  readonly name: string;

  /**
   * Gets a one-line summary of what the tool will do.
   */
  readonly detail: string;

  /**
   * Gets a value indicating whether the run is scoped to a workspace, so the prompt can offer to
   * remember the decision for that workspace.
   */
  readonly hasWorkspace: boolean;
}

/**
 * Withdraws a permission prompt the renderer is still showing because it was answered elsewhere — a
 * remote peer approved or declined the same tool call first (#331 remote control). The renderer
 * drops the matching pending prompt from the transcript; the run has already been resolved in the main
 * process, so no reply is expected. Distinct from a run abort, which tears the entire run down.
 */
export interface AiPermissionDismissedEvent extends AiEventBase {
  /**
   * Gets the discriminator.
   */
  readonly kind: 'permission-dismissed';

  /**
   * Gets the identifier of the permission prompt to withdraw (matches {@link AiPermissionEvent.permissionId}).
   */
  readonly permissionId: string;
}

/**
 * A suggested answer to an agent question: a short label the run is answered with, plus an optional
 * explanation of what picking it means.
 */
export interface AiInputChoice {
  /**
   * Gets the short answer label (this is the text sent back as the answer when picked).
   */
  readonly label: string;

  /**
   * Gets the explanation of this choice (trade-offs, why it might be recommended), or undefined for
   * none.
   */
  readonly description?: string;
}

/**
 * Asks the user a question the agent needs answered before it continues. Raised by the in-app
 * `ask_user` tool; the provider blocks on the answer exactly as it blocks on a permission decision.
 * Answered with an `AiInputReply` carrying the {@link inputId}.
 */
export interface AiInputRequestEvent extends AiEventBase {
  /**
   * Gets the discriminator.
   */
  readonly kind: 'input-request';

  /**
   * Gets the identifier the renderer answers the request with.
   */
  readonly inputId: string;

  /**
   * Gets the question the agent is asking.
   */
  readonly question: string;

  /**
   * Gets the suggested answers the user can pick from, or empty for a free-form question. A free-form
   * answer is always accepted, so the choices are suggestions rather than a closed set.
   */
  readonly choices: readonly AiInputChoice[];
}

/**
 * Withdraws an agent question the renderer is still showing because it was answered elsewhere — a
 * remote peer answered the same `ask_user` prompt first, by answering on another device during
 * remote control (#331). The renderer marks the matching pending question dismissed; the run has
 * already been resolved in the main process, so no reply is expected. The input counterpart of
 * {@link AiPermissionDismissedEvent}.
 */
export interface AiInputDismissedEvent extends AiEventBase {
  /**
   * Gets the discriminator.
   */
  readonly kind: 'input-dismissed';

  /**
   * Gets the identifier of the question to withdraw (matches {@link AiInputRequestEvent.inputId}).
   */
  readonly inputId: string;
}

/**
 * Asks the user to decide on a staged edit preview: the prospective change is showing as a diff in
 * the document well (code targets) or summarised on the card (markdown, which has no diff editor),
 * and the run blocks until they apply or reject it. Answered with an `AiEditDecisionReply`.
 */
export interface AiEditDecisionEvent extends AiEventBase {
  /**
   * Gets the discriminator.
   */
  readonly kind: 'edit-decision';

  /**
   * Gets the identifier the renderer answers the request with.
   */
  readonly decisionId: string;

  /**
   * Gets the display name of the document being edited.
   */
  readonly name: string;

  /**
   * Gets a one-line summary of the staged change.
   */
  readonly detail: string;

  /**
   * Gets a value indicating whether the staged change is showing as a diff in the document well
   * (code targets; markdown has no diff editor).
   */
  readonly hasDiff: boolean;
}

/**
 * Reports the provider session the run belongs to, so the renderer can resume it on the next turn and
 * the model keeps the conversation's context. Emitted for providers that support session continuation
 * (the Claude Agent SDK); the session id is stable across a resumed conversation.
 */
export interface AiSessionEvent extends AiEventBase {
  /**
   * Gets the discriminator.
   */
  readonly kind: 'session';

  /**
   * Gets the provider session identifier to resume the conversation with on the next turn.
   */
  readonly sessionId: string;
}

/**
 * Reports a change in the run's lifecycle.
 */
export interface AiStatusEvent extends AiEventBase {
  /**
   * Gets the discriminator.
   */
  readonly kind: 'status';

  /**
   * Gets the new lifecycle state.
   */
  readonly state: AiRunState;

  /**
   * Gets a short human-readable description of the state.
   */
  readonly detail: string;
}

/**
 * Reports the token usage of a completed model turn, so the renderer can show a running context-size
 * and cost readout. Emitted once per turn by providers that report usage (all three do); the counts
 * are for that turn (its full input — including any cached/re-sent context — and its output), so the
 * latest turn's input plus output approximates the size the conversation now occupies in the context
 * window.
 */
export interface AiUsageEvent extends AiEventBase {
  /**
   * Gets the discriminator.
   */
  readonly kind: 'usage';

  /**
   * Gets the turn's total input tokens, including any cached or re-sent conversation context.
   */
  readonly inputTokens: number;

  /**
   * Gets the turn's output tokens.
   */
  readonly outputTokens: number;

  /**
   * Gets the turn's cost in US dollars, when the provider reports it (the Claude Agent SDK does; the
   * AI-SDK providers do not), or null when unknown.
   */
  readonly costUsd: number | null;
}

/**
 * A slash command a live provider offers, discovered from its session (#330). The `name` has no leading
 * slash; `argumentHint` describes any arguments (empty when none).
 */
export interface AiSlashCommand {
  /**
   * Gets the command name, without a leading slash.
   */
  readonly name: string;

  /**
   * Gets a one-line description of what the command does.
   */
  readonly description: string;

  /**
   * Gets a hint describing the command's arguments, or empty when it takes none.
   */
  readonly argumentHint: string;
}

/**
 * Reports the slash commands a live-harness provider offers, discovered from its held-open session and
 * refreshed when the provider pushes a change (#330). The renderer merges these into the composer's `/`
 * menu (deduping app-native commands); a picked command is dispatched into the live session as input.
 */
export interface AiCommandsEvent extends AiEventBase {
  /**
   * Gets the discriminator.
   */
  readonly kind: 'commands';

  /**
   * Gets the conversation (agent session) the commands belong to, so the renderer correlates them to
   * the right agent regardless of which turn is in flight — command discovery is session-level, not
   * per-turn. Null for a run with no agent session id.
   */
  readonly agentSessionId: string | null;

  /**
   * Gets the provider's current command set (replaces any previously reported set).
   */
  readonly commands: readonly AiSlashCommand[];
}

/**
 * Reports that the agent has started a task — a `run_in_background` shell command, a subagent, or a
 * local workflow. Like {@link AiCommandsEvent} it is session-level rather than per-turn (it carries the
 * agent session id) because a task outlives the turn that launched it: the launching turn can end while
 * the task runs on, and its later progress and settle events must still correlate to the same agent.
 */
export interface AiTaskStartedEvent extends AiEventBase {
  /**
   * Gets the discriminator.
   */
  readonly kind: 'task-started';

  /**
   * Gets the conversation (agent session) the task belongs to, so the renderer correlates it to the
   * right agent regardless of which turn is in flight. Null for a run with no agent session id.
   */
  readonly agentSessionId: string | null;

  /**
   * Gets the provider's identifier for the task (the SDK's `task_id`), the key every later event for
   * this task carries.
   */
  readonly taskId: string;

  /**
   * Gets the `toolId` of the tool use that started the task (the SDK's `tool_use_id`), when known, so a
   * renderer can correlate the task to the tool card that launched it.
   */
  readonly toolId?: string;

  /**
   * Gets the one-line description of what the task is doing.
   */
  readonly description: string;

  /**
   * Gets the subagent type for a Task-tool subagent (the SDK's `subagent_type`), when the task is one.
   */
  readonly agentType?: string;

  /**
   * Gets the provider's task classification (the SDK's `task_type`), when reported — used to tell a
   * subagent apart from a local workflow.
   */
  readonly taskType?: string;

  /**
   * Gets the workflow's name (the SDK's `workflow_name`), set only when the task is a local workflow.
   */
  readonly workflowName?: string;

  /**
   * Gets whether the task is ambient housekeeping the transcript should hide (the SDK's
   * `skip_transcript`). A tasks surface may still list it.
   */
  readonly skipTranscript?: boolean;
}

/**
 * Reports progress for a running task. Session-level for the same reason as {@link AiTaskStartedEvent}:
 * progress arrives while the launching turn may already have ended.
 */
export interface AiTaskProgressEvent extends AiEventBase {
  /**
   * Gets the discriminator.
   */
  readonly kind: 'task-progress';

  /**
   * Gets the conversation (agent session) the task belongs to, so the renderer correlates it to the
   * right agent regardless of which turn is in flight. Null for a run with no agent session id.
   */
  readonly agentSessionId: string | null;

  /**
   * Gets the provider's identifier for the task (the SDK's `task_id`).
   */
  readonly taskId: string;

  /**
   * Gets the current one-line description of what the task is doing.
   */
  readonly description: string;

  /**
   * Gets the name of the last tool the task ran (the SDK's `last_tool_name`), when reported.
   */
  readonly lastToolName?: string;

  /**
   * Gets the task's running total of tokens consumed.
   */
  readonly tokens: number;

  /**
   * Gets the task's running count of tool uses.
   */
  readonly toolUses: number;

  /**
   * Gets how long the task has been running, in milliseconds.
   */
  readonly durationMs: number;
}

/**
 * Reports a change to a task's state — the SDK sends a wire-safe patch of only the fields that changed,
 * which consumers merge into their local task map rather than treating as a whole task. Session-level for
 * the same reason as {@link AiTaskStartedEvent}.
 */
export interface AiTaskUpdatedEvent extends AiEventBase {
  /**
   * Gets the discriminator.
   */
  readonly kind: 'task-updated';

  /**
   * Gets the conversation (agent session) the task belongs to, so the renderer correlates it to the
   * right agent regardless of which turn is in flight. Null for a run with no agent session id.
   */
  readonly agentSessionId: string | null;

  /**
   * Gets the provider's identifier for the task (the SDK's `task_id`).
   */
  readonly taskId: string;

  /**
   * Gets the task's new lifecycle state, when the patch changed it.
   */
  readonly status?: 'pending' | 'running' | 'completed' | 'failed' | 'killed' | 'paused';

  /**
   * Gets the task's new description, when the patch changed it.
   */
  readonly description?: string;

  /**
   * Gets the task's failure text, when the patch reported one.
   */
  readonly error?: string;

  /**
   * Gets whether the task has been moved to the background, when the patch changed it.
   */
  readonly backgrounded?: boolean;

  /**
   * Gets when the task ended, as a Unix epoch in milliseconds, when the patch reported it.
   */
  readonly endTime?: number;
}

/**
 * Reports that a task the agent backgrounded (a `run_in_background` shell command, a backgrounded
 * subagent) has settled. A live-harness holds its session open across turns, so this can arrive after
 * the turn that launched the task has already finished and the conversation has gone idle — the agent
 * said "I'll tell you when it's done" and only now can. Like {@link AiCommandsEvent} it is session-level,
 * not per-turn, so it carries the agent session id to correlate it independent of which turn (if any)
 * is in flight, and the renderer surfaces it as a spontaneous transcript note and a notification.
 */
export interface AiBackgroundTaskEvent extends AiEventBase {
  /**
   * Gets the discriminator.
   */
  readonly kind: 'background-task';

  /**
   * Gets the conversation (agent session) the task belongs to, so the renderer correlates it to the
   * right agent regardless of which turn is in flight. Null for a run with no agent session id.
   */
  readonly agentSessionId: string | null;

  /**
   * Gets the provider's identifier for the task (the SDK's `task_id`), so the settle correlates to the
   * task registry entry opened by {@link AiTaskStartedEvent}.
   */
  readonly taskId: string;

  /**
   * Gets how the task settled.
   */
  readonly status: 'completed' | 'failed' | 'stopped';

  /**
   * Gets the path of the file holding the task's real output (the SDK's `output_file`). The summary is
   * one line; this is where the work itself landed, so a consumer can read the result back rather than
   * only reporting that it finished.
   */
  readonly outputFile: string;

  /**
   * Gets the one-line summary of what the task did (the SDK's `summary`), shown on the note.
   */
  readonly summary: string;

  /**
   * Gets the `toolId` of the tool use that started the task (the SDK's `tool_use_id`), when known, so
   * the note can reference the originating tool.
   */
  readonly toolId?: string;

  /**
   * Gets whether the task is ambient housekeeping the transcript should hide (the SDK's
   * `skip_transcript`). Its settle raises no inline note and no notification; a tasks surface may
   * still list it.
   */
  readonly skipTranscript?: boolean;
}

/**
 * Reports a message a peer typed from claude.ai/code while remote-controlling the session (#331). It is
 * session-level (correlated by {@link agentSessionId}, not the per-turn request id) because it can
 * arrive when no Studio-initiated turn is active: the renderer echoes it into the transcript as the
 * user's message and adopts the turn under {@link AiEventBase.requestId}, so the response — and any
 * permission or input prompts the turn raises — render in Studio too.
 */
export interface AiRemoteMessageEvent extends AiEventBase {
  /**
   * Gets the discriminator.
   */
  readonly kind: 'remote-message';

  /**
   * Gets the conversation (agent session) the message belongs to, so the renderer correlates it to the
   * right agent regardless of which turn (if any) is in flight. Null for a run with no agent session id.
   */
  readonly agentSessionId: string | null;

  /**
   * Gets the peer's message text.
   */
  readonly text: string;
}

/**
 * A streamed event from a running agent turn. Both providers parse their model output into this
 * provider-agnostic protocol.
 */
export type AiEvent =
  | AiTextEvent
  | AiThinkingEvent
  | AiToolStartEvent
  | AiToolEndEvent
  | AiPermissionEvent
  | AiPermissionDismissedEvent
  | AiInputRequestEvent
  | AiInputDismissedEvent
  | AiEditDecisionEvent
  | AiSessionEvent
  | AiStatusEvent
  | AiUsageEvent
  | AiCommandsEvent
  | AiTaskStartedEvent
  | AiTaskProgressEvent
  | AiTaskUpdatedEvent
  | AiBackgroundTaskEvent
  | AiRemoteMessageEvent;
