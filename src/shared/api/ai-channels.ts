// The AI-agent capability's slice of the IPC contract. The renderer's Ai client and the main-process
// AiManager both name their channels from here, carried over the generic window.bridge transport. The
// API key is never exposed through this surface — only narrow status, configuration, run-control,
// verification, event-stream, and in-app-capability calls cross the bridge. The rich payload shapes
// live in the shared ai-types module, which both the renderer and the main-process providers consume.

import type {
  AiAuthStatus,
  AiBridgeReply,
  AiBridgeRequest,
  AiEvent,
  AiInputReply,
  AiPermissionReply,
  AiProviderInfo,
  AiRunRequest,
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

  /**
   * Sends the user's answer to an input request (an agent question) back to the main process.
   * @param reply The reply.
   */
  respondInput(reply: AiInputReply): void;
}
