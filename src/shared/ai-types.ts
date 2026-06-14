// Shared AI-agent contract between the Electron (back-end) and Angular (front-end) processes.
// Keep this module platform-neutral (types only — no Node or DOM dependencies) so both
// compilation targets can import it.

/**
 * The in-app capability that returns the active editor document's text.
 */
export const READ_ACTIVE_DOCUMENT: string = 'read_active_document';

/**
 * The in-app capability that replaces the active editor document's text.
 */
export const REPLACE_ACTIVE_DOCUMENT: string = 'replace_active_document';

/**
 * Identifies where the agent's Anthropic credentials come from.
 *
 * - `local-login`: the user's local Claude login (`~/.claude`), the same credential Claude Code uses.
 * - `api-key`: a user-supplied API key, stored encrypted at rest, or `ANTHROPIC_API_KEY` in dev.
 * - `none`: no credential is available; the agent cannot run until the user logs in or sets a key.
 */
export type AiAuthSource = 'local-login' | 'api-key' | 'none';

/**
 * Describes the agent's current authentication state, safe to surface in the UI. It never carries the
 * API key itself — the key stays in the main process.
 */
export interface AiAuthStatus {
  /**
   * Gets the resolved credential source.
   */
  readonly source: AiAuthSource;

  /**
   * Gets a value indicating whether a usable credential is available (true unless {@link source} is
   * `none`).
   */
  readonly available: boolean;

  /**
   * Gets a value indicating whether a user-supplied API key is stored (independent of whether it is
   * the active source — a stored key may be shadowed by a local login).
   */
  readonly hasStoredKey: boolean;

  /**
   * Gets a short human-readable description of the current state, suitable for settings UI.
   */
  readonly detail: string;
}

/**
 * Reports the outcome of an end-to-end authentication check (a minimal real agent turn).
 */
export interface AiVerifyResult {
  /**
   * Gets a value indicating whether the agent authenticated and produced a response.
   */
  readonly ok: boolean;

  /**
   * Gets a short human-readable description of the outcome.
   */
  readonly detail: string;
}

/**
 * Identifies an agent provider implementation.
 *
 * - `claude`: the Claude Agent SDK (local login or API key; deep local agentic capability).
 * - `vercel`: the Vercel AI SDK (API key only; the seam to additional model back-ends later).
 */
export type AiProviderId = 'claude' | 'vercel';

/**
 * Describes a registered provider and whether it can currently run.
 */
export interface AiProviderInfo {
  /**
   * Gets the provider's stable identifier.
   */
  readonly id: AiProviderId;

  /**
   * Gets the provider's human-readable label.
   */
  readonly label: string;

  /**
   * Gets a value indicating whether the provider has what it needs to run (credentials, etc.).
   */
  readonly available: boolean;

  /**
   * Gets a short human-readable description of the provider's availability.
   */
  readonly detail: string;
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
   * Gets the user's prompt.
   */
  readonly prompt: string;

  /**
   * Gets the open workspace root the agent should act within, or null for none (the agent then runs
   * against the user's home directory).
   */
  readonly workspaceRoot: string | null;
}

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
 * A streamed event from a running agent turn. Both providers parse their model output into this
 * provider-agnostic protocol.
 */
export type AiEvent =
  | AiTextEvent
  | AiThinkingEvent
  | AiToolStartEvent
  | AiToolEndEvent
  | AiPermissionEvent
  | AiStatusEvent;

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
 * The renderer's answer to a permission request carried by a {@link AiPermissionEvent}.
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
}

/**
 * Defines the AI-agent operations exposed to the renderer process. The API key is never exposed
 * through this surface — only narrow status, configuration, run-control, and verification calls cross
 * the bridge.
 */
export interface AiApi {
  /**
   * Gets the current authentication status.
   * @returns Returns the resolved {@link AiAuthStatus}.
   */
  getAuthStatus(): Promise<AiAuthStatus>;

  /**
   * Stores a user-supplied API key, encrypted at rest, and returns the updated status.
   * @param key The Anthropic API key to store.
   * @returns Returns the updated {@link AiAuthStatus}.
   */
  setApiKey(key: string): Promise<AiAuthStatus>;

  /**
   * Clears any stored API key and returns the updated status.
   * @returns Returns the updated {@link AiAuthStatus}.
   */
  clearApiKey(): Promise<AiAuthStatus>;

  /**
   * Runs a minimal agent turn to confirm the resolved credential authenticates end-to-end.
   * @returns Returns the {@link AiVerifyResult}.
   */
  verifyAuthentication(): Promise<AiVerifyResult>;

  /**
   * Lists the registered providers and their current availability.
   * @returns Returns the providers.
   */
  listProviders(): Promise<readonly AiProviderInfo[]>;

  /**
   * Starts an agent turn. Events stream back through {@link onEvent}; the call resolves once the turn
   * has been accepted (not when it completes).
   * @param request The run request.
   */
  run(request: AiRunRequest): Promise<void>;

  /**
   * Aborts a running agent turn.
   * @param requestId The identifier of the run to abort.
   */
  abort(requestId: string): Promise<void>;

  /**
   * Subscribes to streamed events from running agent turns.
   * @param listener Receives each {@link AiEvent}.
   * @returns Returns a function that removes the listener.
   */
  onEvent(listener: (event: AiEvent) => void): () => void;

  /**
   * Subscribes to in-app capability requests from the main process.
   * @param handler Receives each {@link AiBridgeRequest}; answer with {@link respondBridge}.
   * @returns Returns a function that removes the handler.
   */
  onBridgeRequest(handler: (request: AiBridgeRequest) => void): () => void;

  /**
   * Sends the reply to an in-app capability request back to the main process.
   * @param reply The reply.
   */
  respondBridge(reply: AiBridgeReply): void;

  /**
   * Sends the user's answer to a permission request back to the main process.
   * @param reply The reply.
   */
  respondPermission(reply: AiPermissionReply): void;
}
