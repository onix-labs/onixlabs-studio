import { Service } from '@angular/core';
import { AiChannel, AiClient } from '@shared/api/ai-channels';
import { Bridge } from '@shared/api/bridge';
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
} from '@shared/api/ai-types';

/**
 * Builds an {@link AiClient} that forwards each operation to its {@link AiChannel} over the generic
 * transport. Auth/config/run-control map to `invoke`; the event and in-app-capability streams map to
 * `on` (the transport strips the Electron event and hands back an unsubscribe); the replies map to
 * `send`. Kept as a free function so the client is assembled from a non-null bridge.
 * @param bridge The generic transport to forward over.
 * @returns Returns the client bound to the bridge.
 */
function createClient(bridge: Bridge): AiClient {
  return {
    getConnectionAuthStatus: (request: AiConnectionAuthRequest): Promise<AiAuthStatus> =>
      bridge.invoke(AiChannel.ConnectionAuthStatus, request),
    setConnectionKey: (request: AiSetConnectionKeyRequest): Promise<AiAuthStatus> =>
      bridge.invoke(AiChannel.SetConnectionKey, request),
    clearConnectionKey: (request: AiConnectionAuthRequest): Promise<AiAuthStatus> =>
      bridge.invoke(AiChannel.ClearConnectionKey, request),
    listProviders: (connections: readonly AiConnection[]): Promise<readonly AiProviderInfo[]> =>
      bridge.invoke(AiChannel.ListProviders, connections),
    discoverModels: (request: AiDiscoverModelsRequest): Promise<AiDiscoverModelsResult> =>
      bridge.invoke(AiChannel.DiscoverModels, request),
    run: (request: AiRunRequest): Promise<void> => bridge.invoke(AiChannel.Run, request),
    abort: (requestId: string): Promise<void> => bridge.invoke(AiChannel.Abort, requestId),
    steer: (request: AiSteerRequest): Promise<boolean> => bridge.invoke(AiChannel.Steer, request),
    closeSession: (agentSessionId: string): Promise<void> =>
      bridge.invoke(AiChannel.CloseSession, agentSessionId),
    onEvent: (listener: (event: AiEvent) => void): (() => void) =>
      bridge.on(AiChannel.Event, (...args: unknown[]): void => listener(args[0] as AiEvent)),
    onBridgeRequest: (handler: (request: AiBridgeRequest) => void): (() => void) =>
      bridge.on(AiChannel.BridgeRequest, (...args: unknown[]): void =>
        handler(args[0] as AiBridgeRequest),
      ),
    respondBridge: (reply: AiBridgeReply): void => {
      bridge.send(AiChannel.BridgeReply, reply);
    },
    respondPermission: (reply: AiPermissionReply): void => {
      bridge.send(AiChannel.PermissionReply, reply);
    },
    respondInput: (reply: AiInputReply): void => {
      bridge.send(AiChannel.InputReply, reply);
    },
    respondEditDecision: (reply: AiEditDecisionReply): void => {
      bridge.send(AiChannel.EditDecisionReply, reply);
    },
  };
}

/**
 * Represents the renderer-side client for the AI-agent capability. It wraps the generic {@link Bridge}
 * transport, exposing the typed {@link AiClient} operations under {@link Ai.client}.
 *
 * When the application runs outside Electron (served as a plain web app or under unit tests) the bridge
 * is absent and {@link Ai.client} is undefined, so the agent services degrade to safe no-ops exactly as
 * before, when the operations were read from `window.studio.ai`.
 */
@Service()
export class Ai {
  /**
   * Gets the AI-agent operations, or undefined when running outside Electron.
   */
  public readonly client: AiClient | undefined = window.bridge
    ? createClient(window.bridge)
    : undefined;
}
