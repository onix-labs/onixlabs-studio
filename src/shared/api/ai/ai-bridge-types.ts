// Shared AI-agent bridge contract (main-process capability requests and the renderer's replies),
// platform-neutral (types only) so both the Electron back-end and the Angular front-end can import it.

/**
 * A request from the main process for the renderer to fulfil an in-app capability (read/write a
 * document, etc.). Correlated with its reply by {@link requestId}.
 */
export interface AiBridgeRequest {
  /**
   * Gets the correlation identifier the reply must echo.
   */
  readonly requestId: string;

  /**
   * Gets the name of the capability to invoke.
   */
  readonly capability: string;

  /**
   * Gets the capability's input.
   */
  readonly input: unknown;
}

/**
 * The renderer's reply to an {@link AiBridgeRequest}.
 */
export interface AiBridgeReply {
  /**
   * Gets the correlation identifier of the request being answered.
   */
  readonly requestId: string;

  /**
   * Gets a value indicating whether the capability succeeded.
   */
  readonly ok: boolean;

  /**
   * Gets the capability's result, when successful.
   */
  readonly result?: unknown;

  /**
   * Gets the error message, when it failed.
   */
  readonly error?: string;
}

/**
 * How long a granted permission is remembered by the broker: for the rest of the app session, for
 * the current workspace (persisted), or everywhere (persisted). A grant with no remember scope
 * applies to this one tool use only.
 */
export type AiPermissionRemember = 'session' | 'workspace' | 'always';

/**
 * The renderer's answer to a permission request carried by an `AiPermissionEvent`.
 */
export interface AiPermissionReply {
  /**
   * Gets the identifier of the permission request being answered.
   */
  readonly permissionId: string;

  /**
   * Gets a value indicating whether the user granted permission.
   */
  readonly granted: boolean;

  /**
   * Gets how long the broker remembers a grant (undefined for this one use only). Ignored on a
   * denial — refusals are never remembered, so a mis-click can never silently brick a tool.
   */
  readonly remember?: AiPermissionRemember;
}

/**
 * The user's decision on a staged edit preview: apply it, apply it and auto-accept further edits for
 * the rest of the session, or reject it.
 */
export type AiEditDecision = 'yes' | 'yes-auto' | 'no';

/**
 * The renderer's answer to an edit-decision request carried by an `AiEditDecisionEvent`.
 */
export interface AiEditDecisionReply {
  /**
   * Gets the identifier of the edit decision being answered.
   */
  readonly decisionId: string;

  /**
   * Gets the user's decision.
   */
  readonly choice: AiEditDecision;
}

/**
 * Identifies a task to stop: the conversation running it, and the provider's task id.
 */
export interface AiStopTaskRequest {
  /**
   * Gets the conversation whose session owns the task.
   */
  readonly agentSessionId: string;

  /**
   * Gets the provider's identifier for the task.
   */
  readonly taskId: string;
}

/**
 * A request to inject a user message into an in-flight run (mid-run steering). Accepted only when the
 * run's provider supports streaming input (the Claude Agent SDK); the manager answers whether the
 * message was taken, so the renderer can queue it for after the run instead.
 */
export interface AiSteerRequest {
  /**
   * Gets the identifier of the run to steer.
   */
  readonly requestId: string;

  /**
   * Gets the user message to inject.
   */
  readonly text: string;
}

/**
 * The renderer's answer to a question carried by an `AiInputRequestEvent`.
 */
export interface AiInputReply {
  /**
   * Gets the identifier of the input request being answered.
   */
  readonly inputId: string;

  /**
   * Gets the user's answer, or null when they declined to answer (the agent is told and continues
   * without one).
   */
  readonly answer: string | null;
}
