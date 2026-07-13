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
 * A streamed event from a running agent turn. Both providers parse their model output into this
 * provider-agnostic protocol.
 */
export type AiEvent =
  | AiTextEvent
  | AiThinkingEvent
  | AiToolStartEvent
  | AiToolEndEvent
  | AiPermissionEvent
  | AiInputRequestEvent
  | AiSessionEvent
  | AiStatusEvent
  | AiUsageEvent;
