import { BrowserWindow, ipcMain, IpcMainInvokeEvent } from 'electron';
import type {
  AiEvent,
  AiProviderId,
  AiProviderInfo,
  AiRunRequest,
  AiRunState,
  AiVerifyResult,
} from '../../shared/ai-types';
import { IpcChannel } from '../../shared/ipc-channels';
import type { AgentAuth, AgentProvider, AgentRunContext, ProviderAvailability } from './agent-provider';
import { AiAuthManager } from './ai-auth-manager';
import { ClaudeAgentProvider } from './claude-agent-provider';
import { VercelAiProvider } from './vercel-ai-provider';

/**
 * Coordinates the agent subsystem in the main process: authentication (delegated to
 * {@link AiAuthManager}), a registry of {@link AgentProvider}s behind one seam, and the run/abort
 * lifecycle that streams provider-agnostic events to the renderer. Mirrors the other IPC managers
 * (register + windowGetter + `ipcMain.handle`/`webContents.send`).
 */
export class AiManager {
  /**
   * Holds the function returning the window agent events are sent to.
   */
  private readonly windowGetter: () => BrowserWindow | null;

  /**
   * Holds the agent credential manager.
   */
  private readonly auth: AiAuthManager = new AiAuthManager();

  /**
   * Holds the Claude provider (also used for the authentication verification turn).
   */
  private readonly claude: ClaudeAgentProvider = new ClaudeAgentProvider();

  /**
   * Holds the registered providers, keyed by id.
   */
  private readonly providers: Map<AiProviderId, AgentProvider>;

  /**
   * Holds the abort controllers of in-flight runs, keyed by request id.
   */
  private readonly runs: Map<string, AbortController> = new Map<string, AbortController>();

  /**
   * Initializes a new instance of the {@link AiManager} class.
   * @param windowGetter A function that returns the window agent events are sent to.
   */
  public constructor(windowGetter: () => BrowserWindow | null) {
    this.windowGetter = windowGetter;
    const vercel: VercelAiProvider = new VercelAiProvider();
    this.providers = new Map<AiProviderId, AgentProvider>([
      [this.claude.id, this.claude],
      [vercel.id, vercel],
    ]);
  }

  /**
   * Registers the agent IPC handlers (auth, provider listing, run/abort, and verification).
   */
  public register(): void {
    this.auth.register();
    ipcMain.handle(
      IpcChannel.AiVerify,
      (): Promise<AiVerifyResult> => this.claude.verify(this.auth.resolveCredential()),
    );
    ipcMain.handle(IpcChannel.AiListProviders, (): readonly AiProviderInfo[] => this.listProviders());
    ipcMain.handle(IpcChannel.AiRun, (_event: IpcMainInvokeEvent, request: unknown): void => {
      if (this.isRunRequest(request)) {
        this.run(request);
      }
    });
    ipcMain.handle(IpcChannel.AiAbort, (_event: IpcMainInvokeEvent, requestId: unknown): void => {
      if (typeof requestId === 'string') {
        this.abort(requestId);
      }
    });
  }

  /**
   * Aborts every in-flight run (called on shutdown).
   */
  public disposeAll(): void {
    for (const controller of this.runs.values()) {
      controller.abort();
    }
    this.runs.clear();
  }

  /**
   * Resolves the current credential material for providers.
   * @returns Returns the {@link AgentAuth}.
   */
  private currentAuth(): AgentAuth {
    return { hasLocalLogin: this.auth.hasLocalLogin(), apiKey: this.auth.apiKey() };
  }

  /**
   * Lists the registered providers and their current availability.
   * @returns Returns the provider descriptors.
   */
  private listProviders(): readonly AiProviderInfo[] {
    const auth: AgentAuth = this.currentAuth();
    return [...this.providers.values()].map((provider: AgentProvider): AiProviderInfo => {
      const availability: ProviderAvailability = provider.describeAvailability(auth);
      return {
        id: provider.id,
        label: provider.label,
        available: availability.available,
        detail: availability.detail,
      };
    });
  }

  /**
   * Starts an agent turn, streaming its events to the renderer.
   * @param request The run request.
   */
  private run(request: AiRunRequest): void {
    const provider: AgentProvider | undefined = this.providers.get(request.providerId);
    if (provider === undefined) {
      this.emit({
        requestId: request.requestId,
        kind: 'status',
        state: 'error',
        detail: `Unknown provider: ${request.providerId}`,
      });
      return;
    }
    const controller: AbortController = new AbortController();
    this.runs.set(request.requestId, controller);
    const context: AgentRunContext = {
      requestId: request.requestId,
      prompt: request.prompt,
      workspaceRoot: request.workspaceRoot,
      auth: this.currentAuth(),
      signal: controller.signal,
      emit: (event: AiEvent): void => this.emit(event),
    };
    this.emit({
      requestId: request.requestId,
      kind: 'status',
      state: 'started',
      detail: provider.label,
    });
    void provider
      .run(context)
      .then((): void =>
        this.finish(request.requestId, controller.signal.aborted ? 'aborted' : 'completed', ''),
      )
      .catch((error: unknown): void =>
        this.finish(request.requestId, 'error', error instanceof Error ? error.message : String(error)),
      );
  }

  /**
   * Ends a run: drops its controller and emits a terminal status event.
   * @param requestId The run's identifier.
   * @param state The terminal state.
   * @param detail A short description.
   */
  private finish(requestId: string, state: AiRunState, detail: string): void {
    this.runs.delete(requestId);
    this.emit({ requestId, kind: 'status', state, detail });
  }

  /**
   * Aborts an in-flight run.
   * @param requestId The run's identifier.
   */
  private abort(requestId: string): void {
    this.runs.get(requestId)?.abort();
  }

  /**
   * Sends an event to the renderer.
   * @param event The event to send.
   */
  private emit(event: AiEvent): void {
    this.windowGetter()?.webContents.send(IpcChannel.AiEvent, event);
  }

  /**
   * Narrows an untrusted IPC payload to a {@link AiRunRequest}.
   * @param value The payload.
   * @returns Returns true when the payload has the required shape.
   */
  private isRunRequest(value: unknown): value is AiRunRequest {
    if (value === null || typeof value !== 'object') {
      return false;
    }
    const record: Record<string, unknown> = value as Record<string, unknown>;
    return (
      typeof record['requestId'] === 'string' &&
      typeof record['providerId'] === 'string' &&
      typeof record['prompt'] === 'string'
    );
  }
}
