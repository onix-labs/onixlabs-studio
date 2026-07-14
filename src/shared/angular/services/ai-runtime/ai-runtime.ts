import { inject, Service } from '@angular/core';
import type { AiClient } from '@shared/api/ai-channels';
import type {
  AgentContextRef,
  AgentMode,
  AgentSurface,
  AiBridgeRequest,
  AiConnection,
  AiEditDecision,
  AiEvent,
  AiImageRef,
  AiPermissionPosture,
  AiPermissionRemember,
  AiProviderId,
  AiProviderInfo,
} from '@shared/api/ai-types';
import { Ai } from '@shared/angular/services/ai/ai';

/**
 * A renderer-side in-app capability the agent can invoke through the bridge. Receives the request's
 * input and returns the result directly or as a promise (the runtime awaits it either way).
 */
export type AiCapability = (input: unknown) => unknown;

/**
 * The optional per-run settings for an agent turn. Omitted values fall back to safe defaults (no
 * workspace, provider-default model, ask-every-time posture, no token cap).
 */
export interface AiRunOptions {
  /**
   * Gets the workspace the agent should act within, or null for none.
   */
  readonly workspaceRoot?: string | null;

  /**
   * Gets the identifier of the model to run with; the main process falls back to the provider's
   * default when empty or unknown.
   */
  readonly model?: string;

  /**
   * Gets how much the agent may do without asking the user first.
   */
  readonly permissionPosture?: AiPermissionPosture;

  /**
   * Gets the per-request token budget, or 0 for the provider default (no cap).
   */
  readonly tokenCap?: number;

  /**
   * Gets the wall-clock budget the run is aborted after, in milliseconds, or 0/omitted for none.
   */
  readonly runTimeoutMs?: number;

  /**
   * Gets the identifier of the editor tab that owns this run, so the agent's in-app editor tools act
   * on that tab's editor. Omitted for runs with no owning editor (the standalone agent tab).
   */
  readonly owningTabId?: string;

  /**
   * Gets what this run acts on, which selects the tool set the providers expose. Defaults to `editor`
   * when omitted.
   */
  readonly surface?: AgentSurface;

  /**
   * Gets how much autonomy the agent runs with. Defaults to `agent` (full tools); `chat` runs
   * read-only.
   */
  readonly mode?: AgentMode;

  /**
   * Gets the files and folders attached to the run's context, referenced by path for the agent to read
   * with its own file tools. Omitted when nothing is attached.
   */
  readonly contextPaths?: readonly AgentContextRef[];

  /**
   * Gets the provider session to resume so the model keeps the conversation's prior context, or null/
   * omitted to start a fresh session (a conversation's first turn).
   */
  readonly resumeSessionId?: string | null;

  /**
   * Gets the provider message to resume up to (and including) when branching, so discarded turns
   * never reach the model. Used with {@link resumeSessionId} and {@link forkSession}.
   */
  readonly resumeSessionAt?: string;

  /**
   * Gets a value indicating whether the resumed session forks to a new session id rather than
   * continuing (branching keeps the original session untouched).
   */
  readonly forkSession?: boolean;

  /**
   * Gets the images attached to the turn, sent to the model alongside the prompt.
   */
  readonly images?: readonly AiImageRef[];
}

/**
 * Renderer-side runtime for the agent: the single place the streamed event subscription lives, the
 * run/abort surface consumers drive, and the registry that answers the main process's in-app
 * capability requests. Higher-level features (the chat transcript #110, in-app tools #142) build on
 * it. Outside Electron the bridge is absent and every operation degrades to a safe no-op.
 */
@Service()
export class AiRuntime {
  /**
   * Holds the agent client, or undefined when running outside Electron.
   */
  private readonly api: AiClient | undefined = inject(Ai).client;

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
   * Rebuilds the main-process providers from the user's connections and lists them with their
   * availability.
   * @param connections The user's configured connections.
   * @returns Returns the providers (empty outside Electron).
   */
  public listProviders(connections: readonly AiConnection[]): Promise<readonly AiProviderInfo[]> {
    return this.api?.listProviders(connections) ?? Promise.resolve([]);
  }

  /**
   * Starts an agent turn. Events stream back through {@link onEvent}.
   * @param providerId The provider to run through.
   * @param prompt The user's prompt.
   * @param options The per-run settings (workspace, model, permission posture, token cap).
   * @returns Returns the run's identifier (used to correlate events and to abort).
   */
  public run(providerId: AiProviderId, prompt: string, options: AiRunOptions = {}): string {
    this.requestCounter += 1;
    const requestId: string = `run-${this.requestCounter}`;
    void this.api?.run({
      requestId,
      providerId,
      model: options.model ?? '',
      prompt,
      workspaceRoot: options.workspaceRoot ?? null,
      permissionPosture: options.permissionPosture ?? 'prompt',
      tokenCap: options.tokenCap ?? 0,
      runTimeoutMs: options.runTimeoutMs ?? 0,
      owningTabId: options.owningTabId ?? null,
      surface: options.surface ?? 'editor',
      mode: options.mode ?? 'agent',
      contextPaths: options.contextPaths ?? [],
      resumeSessionId: options.resumeSessionId ?? null,
      resumeSessionAt: options.resumeSessionAt ?? null,
      forkSession: options.forkSession ?? false,
      images: options.images ?? [],
    });
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
   * Injects a user message into an in-flight run (mid-run steering).
   * @param requestId The identifier of the run to steer.
   * @param text The user message to inject.
   * @returns Returns true when the run took the message; false when the run has ended, its provider
   * does not support steering, or outside Electron.
   */
  public steer(requestId: string, text: string): Promise<boolean> {
    return this.api?.steer({ requestId, text }) ?? Promise.resolve(false);
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
   * @param remember How long the broker remembers a grant, or undefined for this one use only.
   */
  public respondPermission(
    permissionId: string,
    granted: boolean,
    remember?: AiPermissionRemember,
  ): void {
    this.api?.respondPermission({ permissionId, granted, remember });
  }

  /**
   * Answers an input request (an agent question) raised during a run.
   * @param inputId The identifier carried by the input-request event.
   * @param answer The user's answer, or null when they declined to answer.
   */
  public respondInput(inputId: string, answer: string | null): void {
    this.api?.respondInput({ inputId, answer });
  }

  /**
   * Answers an edit-decision request (a staged edit preview) raised during a run.
   * @param decisionId The identifier carried by the edit-decision event.
   * @param choice The user's decision.
   */
  public respondEditDecision(decisionId: string, choice: AiEditDecision): void {
    this.api?.respondEditDecision({ decisionId, choice });
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
