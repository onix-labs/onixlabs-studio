// The AI-agent capability's slice of the IPC contract. The renderer's Ai client and the main-process
// AiManager both name their channels from here, carried over the generic window.bridge transport. The
// API key is never exposed through this surface — only narrow status, configuration, run-control,
// verification, event-stream, and in-app-capability calls cross the bridge. The rich payload shapes
// live in the shared ai-types module, which both the renderer and the main-process providers consume.

import type {
  AiAuthStatus,
  AiBridgeReply,
  AiBridgeRequest,
  AiConnectionAuthRequest,
  AiEditDecisionReply,
  AiEvent,
  AiInputReply,
  AiPermissionReply,
  AiProviderInfo,
  AiRunRequest,
  AiSetConnectionKeyRequest,
  AiSteerRequest,
  AiVerifyResult,
} from '@shared/api/ai-types';

/**
 * Names the AI-agent IPC channels. Auth/config/run-control are request/response `invoke`; the event
 * and in-app-capability streams are main→renderer `on` subscriptions; the replies are renderer→main
 * `send`.
 */
export enum AiChannel {
  /**
   * Gets the current authentication status (invoke).
   */
  AuthStatus = 'ai:auth-status',

  /**
   * Stores a user-supplied API key, encrypted at rest, and returns the updated status (invoke).
   */
  SetApiKey = 'ai:set-api-key',

  /**
   * Clears any stored API key and returns the updated status (invoke).
   */
  ClearApiKey = 'ai:clear-api-key',

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
   * Runs a minimal agent turn to confirm the resolved credential authenticates end-to-end (invoke).
   */
  Verify = 'ai:verify',

  /**
   * Lists the registered providers and their current availability (invoke).
   */
  ListProviders = 'ai:list-providers',

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
   * Injects a user message into an in-flight run (mid-run steering).
   * @param request The steer request.
   * @returns Returns true when the run took the message; false when the run has ended or its
   * provider does not support steering (queue it for after the run instead).
   */
  steer(request: AiSteerRequest): Promise<boolean>;

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
