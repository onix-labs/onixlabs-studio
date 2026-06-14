import { Service } from '@angular/core';
import type {
  AiApi,
  AiBridgeRequest,
  AiEvent,
  AiProviderId,
  AiProviderInfo,
} from '../../../shared/ai-types';

/**
 * A renderer-side in-app capability the agent can invoke through the bridge. Receives the request's
 * input and returns the result directly or as a promise (the runtime awaits it either way).
 */
export type AiCapability = (input: unknown) => unknown;

/**
 * Renderer-side runtime for the agent: the single place the streamed event subscription lives, the
 * run/abort surface consumers drive, and the registry that answers the main process's in-app
 * capability requests. Higher-level features (the chat transcript #110, in-app tools #142) build on
 * it. Outside Electron the bridge is absent and every operation degrades to a safe no-op.
 */
@Service()
export class AiRuntime {
  /**
   * Holds the agent bridge, or undefined when running outside Electron.
   */
  private readonly api: AiApi | undefined = window.studio?.ai;

  /**
   * Holds the event subscribers.
   */
  private readonly listeners: Set<(event: AiEvent) => void> = new Set<(event: AiEvent) => void>();

  /**
   * Holds the registered in-app capability handlers, keyed by name.
   */
  private readonly capabilities: Map<string, AiCapability> = new Map<string, AiCapability>();

  /**
   * Holds the counter that makes run identifiers unique within this session.
   */
  private requestCounter: number = 0;

  /**
   * Gets a value indicating whether a real agent bridge is available (i.e. running in Electron).
   */
  public readonly isAvailable: boolean = this.api !== undefined;

  /**
   * Initializes a new instance of the {@link AiRuntime} class, subscribing to streamed events and
   * in-app capability requests.
   */
  public constructor() {
    this.api?.onEvent((event: AiEvent): void => this.dispatch(event));
    this.api?.onBridgeRequest((request: AiBridgeRequest): void => {
      void this.handleBridgeRequest(request);
    });
  }

  /**
   * Lists the registered providers and their availability.
   * @returns Returns the providers (empty outside Electron).
   */
  public listProviders(): Promise<readonly AiProviderInfo[]> {
    return this.api?.listProviders() ?? Promise.resolve([]);
  }

  /**
   * Starts an agent turn. Events stream back through {@link onEvent}.
   * @param providerId The provider to run through.
   * @param prompt The user's prompt.
   * @param workspaceRoot The workspace the agent should act within, or null for none.
   * @returns Returns the run's identifier (used to correlate events and to abort).
   */
  public run(providerId: AiProviderId, prompt: string, workspaceRoot: string | null = null): string {
    this.requestCounter += 1;
    const requestId: string = `run-${this.requestCounter}`;
    void this.api?.run({ requestId, providerId, prompt, workspaceRoot });
    return requestId;
  }

  /**
   * Aborts a running agent turn.
   * @param requestId The identifier of the run to abort.
   */
  public abort(requestId: string): void {
    void this.api?.abort(requestId);
  }

  /**
   * Subscribes to streamed agent events.
   * @param listener Receives each {@link AiEvent}.
   * @returns Returns a function that removes the listener.
   */
  public onEvent(listener: (event: AiEvent) => void): () => void {
    this.listeners.add(listener);
    return (): void => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Answers a permission request raised during a run.
   * @param permissionId The identifier carried by the permission event.
   * @param granted Whether the user granted permission.
   */
  public respondPermission(permissionId: string, granted: boolean): void {
    this.api?.respondPermission({ permissionId, granted });
  }

  /**
   * Registers an in-app capability the agent can invoke through the bridge.
   * @param name The capability name.
   * @param handler The handler invoked with the request input.
   * @returns Returns a function that unregisters the capability.
   */
  public registerCapability(name: string, handler: AiCapability): () => void {
    this.capabilities.set(name, handler);
    return (): void => {
      this.capabilities.delete(name);
    };
  }

  /**
   * Fans a streamed event out to subscribers.
   * @param event The event.
   */
  private dispatch(event: AiEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  /**
   * Runs the handler for an in-app capability request and replies with the result or error.
   * @param request The capability request.
   */
  private async handleBridgeRequest(request: AiBridgeRequest): Promise<void> {
    const handler: AiCapability | undefined = this.capabilities.get(request.capability);
    if (handler === undefined) {
      this.api?.respondBridge({
        requestId: request.requestId,
        ok: false,
        error: `Unknown capability: ${request.capability}`,
      });
      return;
    }
    try {
      const result: unknown = await handler(request.input);
      this.api?.respondBridge({ requestId: request.requestId, ok: true, result });
    } catch (error: unknown) {
      this.api?.respondBridge({
        requestId: request.requestId,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
