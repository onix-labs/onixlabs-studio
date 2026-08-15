// The AI-agent capability's slice of the IPC contract. The renderer's Ai client and the main-process
// AiManager both name their channels from here, carried over the generic window.bridge transport. The
// API key is never exposed through this surface — only narrow status, configuration, run-control,
// verification, event-stream, and in-app-capability calls cross the bridge. The rich payload shapes
// live in the shared ai-types module, which both the renderer and the main-process providers consume.

import type {
  AiAuthStatus,
  AiBridgeReply,
  AiBridgeRequest,
  AiConnection,
  AiConnectionAuthRequest,
  AiDiscoverModelsRequest,
  AiDiscoverModelsResult,
  AiEditDecisionReply,
  AiEvent,
  AiInputReply,
  AiPermissionReply,
  AiProviderInfo,
  AiRunRequest,
  AiSetConnectionKeyRequest,
  AiSteerRequest,
  ClaudeAuthStatus,
  ClaudeLoginStatus,
} from '@shared/api/ai-types';

/**
 * Names the AI-agent IPC channels. Auth/config/run-control are request/response `invoke`; the event
 * and in-app-capability streams are main→renderer `on` subscriptions; the replies are renderer→main
 * `send`.
 */
export enum AiChannel {
  /**
   * Gets the authentication status of a specific connection (invoke).
   */
  ConnectionAuthStatus = 'ai:connection-auth-status',

  /**
   * Stores a user-supplied API key for a connection, encrypted at rest, and returns the connection's
   * updated status (invoke).
   */
  SetConnectionKey = 'ai:set-connection-key',

  /**
   * Clears a connection's stored API key and returns its updated status (invoke).
   */
  ClearConnectionKey = 'ai:clear-connection-key',

  /**
   * Lists the registered providers and their current availability (invoke).
   */
  ListProviders = 'ai:list-providers',

  /**
   * Discovers a connection's models from its `/models` endpoint and returns the merged list (invoke).
   */
  DiscoverModels = 'ai:discover-models',

  /**
   * Starts an agent turn; events stream back over {@link AiChannel.Event} (invoke).
   */
  Run = 'ai:run',

  /**
   * Aborts a running agent turn (invoke).
   */
  Abort = 'ai:abort',

  /**
   * Injects a user message into an in-flight run (mid-run steering); resolves whether the run took it
   * (invoke).
   */
  Steer = 'ai:steer',

  /**
   * Closes an agent's held-open live session (New chat / tab close); no-op when none is open (invoke).
   */
  CloseSession = 'ai:close-session',

  /**
   * Reads whether Claude Code's mobile push for a remote-controlled agent needing input (a permission
   * prompt or a question) is enabled — the `inputNeededNotifEnabled` user setting (invoke).
   */
  GetRemoteNotifications = 'ai:get-remote-notifications',

  /**
   * Enables or disables Claude Code's mobile push for a remote-controlled agent needing input (invoke).
   */
  SetRemoteNotifications = 'ai:set-remote-notifications',

  /**
   * Reads the authoritative Claude sign-in status (via `claude auth status`), to tell an expired/absent
   * login apart from any other run failure (invoke).
   */
  CheckClaudeAuth = 'ai:check-claude-auth',

  /**
   * Starts the in-app Claude login: drives the `claude` CLI's own OAuth flow (which opens the browser);
   * progress streams back over {@link AiChannel.ClaudeLoginStatus} (invoke).
   */
  StartClaudeLogin = 'ai:start-claude-login',

  /**
   * Cancels an in-flight in-app Claude login (invoke).
   */
  CancelClaudeLogin = 'ai:cancel-claude-login',

  /**
   * Signs the user out of Claude (`claude auth logout`), for testing the sign-in flow (invoke).
   */
  LogoutClaude = 'ai:logout-claude',

  /**
   * Streams progress of the in-app Claude login flow (main→renderer, on).
   */
  ClaudeLoginStatus = 'ai:claude-login-status',

  /**
   * Streams events from running agent turns (main→renderer, on).
   */
  Event = 'ai:event',

  /**
   * Streams in-app capability requests from the main process; answered with {@link AiChannel.BridgeReply}
   * (main→renderer, on).
   */
  BridgeRequest = 'ai:bridge-request',

  /**
   * Sends the reply to an in-app capability request back to the main process (renderer→main, send).
   */
  BridgeReply = 'ai:bridge-reply',

  /**
   * Sends the user's answer to a permission request back to the main process (renderer→main, send).
   */
  PermissionReply = 'ai:permission-reply',

  /**
   * Sends the user's answer to an input request (an agent question) back to the main process
   * (renderer→main, send).
   */
  InputReply = 'ai:input-reply',

  /**
   * Sends the user's decision on a staged edit preview back to the main process (renderer→main,
   * send).
   */
  EditDecisionReply = 'ai:edit-decision-reply',
}

/**
 * Defines the renderer-facing AI-agent operations, each mapping to an {@link AiChannel} over the
 * bridge. The API key is never exposed through this surface — only narrow status, configuration,
 * run-control, and verification calls cross the bridge.
 */
export interface AiClient {
  /**
   * Gets the authentication status of a specific connection.
   * @param request The connection and its auth kind.
   * @returns Returns the connection's {@link AiAuthStatus}.
   */
  getConnectionAuthStatus(request: AiConnectionAuthRequest): Promise<AiAuthStatus>;

  /**
   * Stores a user-supplied API key for a connection, encrypted at rest, and returns the connection's
   * updated status.
   * @param request The connection, its auth kind, and the key to store.
   * @returns Returns the connection's updated {@link AiAuthStatus}.
   */
  setConnectionKey(request: AiSetConnectionKeyRequest): Promise<AiAuthStatus>;

  /**
   * Clears a connection's stored API key and returns its updated status.
   * @param request The connection and its auth kind.
   * @returns Returns the connection's updated {@link AiAuthStatus}.
   */
  clearConnectionKey(request: AiConnectionAuthRequest): Promise<AiAuthStatus>;

  /**
   * Rebuilds the main-process providers from the user's connections and lists them with their current
   * availability. Passing the connections here makes the user's own connections (not just the built-in
   * seeds) runnable, and keeps the main process's provider set in step with the settings.
   * @param connections The user's configured connections.
   * @returns Returns the providers.
   */
  listProviders(connections: readonly AiConnection[]): Promise<readonly AiProviderInfo[]>;

  /**
   * Discovers a connection's models from its `/models` endpoint, merging them into its existing list.
   * @param request The connection to discover models for.
   * @returns Returns the discovery result (the merged list, or the existing list on failure).
   */
  discoverModels(request: AiDiscoverModelsRequest): Promise<AiDiscoverModelsResult>;

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
   * Injects a user message into an in-flight run (mid-run steering).
   * @param request The steer request.
   * @returns Returns true when the run took the message; false when the run has ended or its
   * provider does not support steering (queue it for after the run instead).
   */
  steer(request: AiSteerRequest): Promise<boolean>;

  /**
   * Closes an agent's held-open live session (New chat / tab close). No-op when none is open.
   * @param agentSessionId The agent conversation whose session to close.
   */
  closeSession(agentSessionId: string): Promise<void>;

  /**
   * Reads whether mobile push notifications are enabled for a remote-controlled agent that needs input
   * (a permission prompt or a question). Backed by Claude Code's `inputNeededNotifEnabled` user setting.
   * @returns Returns true when the push is enabled.
   */
  getRemoteNotifications(): Promise<boolean>;

  /**
   * Enables or disables mobile push notifications for a remote-controlled agent that needs input.
   * @param enabled Whether to enable the push.
   */
  setRemoteNotifications(enabled: boolean): Promise<void>;

  /**
   * Reads the authoritative Claude sign-in status (via `claude auth status`), so a failed run can tell
   * an expired/absent login apart from any other failure.
   * @returns Returns the sign-in status ({@link ClaudeAuthStatus.loggedIn} false outside Electron or when
   * the CLI is unavailable).
   */
  checkClaudeAuth(): Promise<ClaudeAuthStatus>;

  /**
   * Starts the in-app Claude login, driving the `claude` CLI's own OAuth flow (which opens the browser).
   * Progress streams through {@link onClaudeLoginStatus}; the call resolves once the flow has been
   * launched (not when it completes).
   */
  startClaudeLogin(): Promise<void>;

  /**
   * Cancels an in-flight in-app Claude login. No-op when none is running.
   */
  cancelClaudeLogin(): Promise<void>;

  /**
   * Signs the user out of Claude (`claude auth logout`), for testing the sign-in flow.
   */
  logoutClaude(): Promise<void>;

  /**
   * Subscribes to progress of the in-app Claude login flow.
   * @param listener Receives each {@link ClaudeLoginStatus}.
   * @returns Returns a function that removes the listener.
   */
  onClaudeLoginStatus(listener: (status: ClaudeLoginStatus) => void): () => void;

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

  /**
   * Sends the user's answer to an input request (an agent question) back to the main process.
   * @param reply The reply.
   */
  respondInput(reply: AiInputReply): void;

  /**
   * Sends the user's decision on a staged edit preview back to the main process.
   * @param reply The reply.
   */
  respondEditDecision(reply: AiEditDecisionReply): void;
}
