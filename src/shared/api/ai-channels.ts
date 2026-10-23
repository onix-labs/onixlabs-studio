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
  AiRemoteControlMode,
  AiRunRequest,
  AiSetConnectionKeyRequest,
  AiSteerRequest,
  AiStopTaskRequest,
  AiSignInProgress,
  AiSignInRequest,
  AiSignInStatus,
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
   * Re-aims a held-open live session's Remote Control exposure (#331) — attaches, detaches, or changes
   * the mode of its claude.ai/code bridge without ending the session; no-op when none is open or the
   * provider does not support the feature (invoke).
   */
  SetSessionRemoteControl = 'ai:set-session-remote-control',

  /**
   * Panic-stops an agent's held-open live session: stops its background tasks, interrupts the
   * in-flight turn — including an adopted task- or peer-driven turn no run is awaiting — and
   * escalates to closing the session if the harness does not respond; no-op when none is open
   * (invoke).
   */
  StopAgent = 'ai:stop-agent',

  /**
   * Stops a task the agent is running in the background; no-op when the session or task has already
   * gone (invoke).
   */
  StopTask = 'ai:stop-task',

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
   * Asks whether the user is signed in to a connection's provider, through its plugin (invoke).
   */
  CheckSignIn = 'ai:check-sign-in',

  /**
   * Starts signing in to a connection's provider, through its plugin; progress streams back over
   * {@link AiChannel.SignInProgress} (invoke).
   */
  StartSignIn = 'ai:start-sign-in',

  /**
   * Cancels the sign-in in flight (invoke).
   */
  CancelSignIn = 'ai:cancel-sign-in',

  /**
   * Signs the user out of a connection's provider, through its plugin (invoke).
   */
  SignOut = 'ai:sign-out',

  /**
   * Streams the progress of a sign-in (main→renderer, on).
   */
  SignInProgress = 'ai:sign-in-progress',

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
   * Re-aims a held-open live session's Remote Control exposure (#331): attaches, detaches, or changes
   * the mode of its claude.ai/code bridge in place, without ending the session. No-op when no session
   * is open (the next turn's open applies the mode instead) or the provider does not support the
   * feature.
   * @param agentSessionId The agent conversation whose session to re-aim.
   * @param mode The remote-control mode the session should now be exposed at.
   */
  setSessionRemoteControl(agentSessionId: string, mode: AiRemoteControlMode): Promise<void>;

  /**
   * Panic-stops an agent's held-open live session: stops its background tasks, interrupts the
   * in-flight turn — including an adopted task- or peer-driven turn no run is awaiting, which the
   * per-run {@link abort} cannot reach — and escalates to closing the session if the harness does not
   * respond. No-op when no session is open.
   * @param agentSessionId The agent conversation whose session to stop.
   */
  stopAgent(agentSessionId: string): Promise<void>;

  /**
   * Stops a task an agent is running in the background. The provider settles it as `stopped`, which
   * arrives through the ordinary task-lifecycle events, so no separate confirmation is needed.
   * @param request The conversation and the task to stop.
   */
  stopTask(request: AiStopTaskRequest): Promise<void>;

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
   * Asks whether the user is signed in to a connection's provider.
   * @param request The connection to ask about.
   * @returns Returns the status; unsupported outside Electron or for a plugin that cannot sign in.
   */
  checkSignIn(request: AiSignInRequest): Promise<AiSignInStatus>;

  /**
   * Starts signing in to a connection's provider. Progress streams through {@link onSignInProgress};
   * the call resolves once the sign-in has started, not when it completes.
   * @param request The connection to sign in to.
   */
  startSignIn(request: AiSignInRequest): Promise<void>;

  /**
   * Cancels the sign-in in flight. No-op when none is running.
   */
  cancelSignIn(): Promise<void>;

  /**
   * Signs the user out of a connection's provider.
   * @param request The connection to sign out of.
   */
  signOut(request: AiSignInRequest): Promise<void>;

  /**
   * Subscribes to the progress of a sign-in.
   * @param listener Receives each {@link AiSignInProgress}.
   * @returns Returns a function that removes the listener.
   */
  onSignInProgress(listener: (progress: AiSignInProgress) => void): () => void;

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
