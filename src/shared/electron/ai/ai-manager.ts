import { randomUUID } from 'node:crypto';
import { BrowserWindow, ipcMain, IpcMainEvent, IpcMainInvokeEvent } from 'electron';
import type {
  AgentContextRef,
  AgentMode,
  AiEvent,
  AiInputChoice,
  AiInputReply,
  AiModelInfo,
  AiPermissionPosture,
  AiPermissionReply,
  AiProviderId,
  AiProviderInfo,
  AiRunRequest,
  AiRunState,
  AiVerifyResult,
} from '@shared/api/ai-types';

/**
 * The permission postures accepted from the renderer, used to validate the untrusted run request.
 */
const PERMISSION_POSTURES: readonly AiPermissionPosture[] = ['prompt', 'auto-edits', 'auto-all'];
import { AiChannel } from '@shared/api/ai-channels';
import type {
  AgentAuth,
  AgentProvider,
  AgentRunContext,
  ProviderAvailability,
} from './agent-provider';
import { AiAuthManager } from './ai-auth-manager';
import { ClaudeAgentProvider } from './claude-agent-provider';
import { OllamaProvider } from './ollama-provider';
import { RendererBridge } from './renderer-bridge';
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
   * Holds the bridge to the renderer's in-app capabilities.
   */
  private readonly bridge: RendererBridge;

  /**
   * Holds the resolvers of pending permission prompts, keyed by permission id.
   */
  private readonly permissions: Map<string, (granted: boolean) => void> = new Map<
    string,
    (granted: boolean) => void
  >();

  /**
   * Holds the resolvers of pending input requests (agent questions), keyed by input id.
   */
  private readonly inputs: Map<string, (answer: string | null) => void> = new Map<
    string,
    (answer: string | null) => void
  >();

  /**
   * Initializes a new instance of the {@link AiManager} class.
   * @param windowGetter A function that returns the window agent events are sent to.
   */
  public constructor(windowGetter: () => BrowserWindow | null) {
    this.windowGetter = windowGetter;
    this.bridge = new RendererBridge(windowGetter);
    const vercel: VercelAiProvider = new VercelAiProvider();
    const ollama: OllamaProvider = new OllamaProvider();
    this.providers = new Map<AiProviderId, AgentProvider>([
      [this.claude.id, this.claude],
      [vercel.id, vercel],
      [ollama.id, ollama],
    ]);
  }

  /**
   * Registers the agent IPC handlers (auth, provider listing, run/abort, and verification).
   */
  public register(): void {
    this.auth.register();
    this.bridge.register();
    ipcMain.on(AiChannel.PermissionReply, (_event: IpcMainEvent, reply: unknown): void => {
      if (this.isPermissionReply(reply)) {
        this.resolvePermission(reply);
      }
    });
    ipcMain.on(AiChannel.InputReply, (_event: IpcMainEvent, reply: unknown): void => {
      if (this.isInputReply(reply)) {
        this.resolveInput(reply);
      }
    });
    ipcMain.handle(
      AiChannel.Verify,
      (): Promise<AiVerifyResult> => this.claude.verify(this.auth.resolveCredential()),
    );
    ipcMain.handle(AiChannel.ListProviders, (): readonly AiProviderInfo[] => this.listProviders());
    ipcMain.handle(AiChannel.Run, (_event: IpcMainInvokeEvent, request: unknown): void => {
      if (this.isRunRequest(request)) {
        this.run(request);
      }
    });
    ipcMain.handle(AiChannel.Abort, (_event: IpcMainInvokeEvent, requestId: unknown): void => {
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
        models: provider.models,
        defaultModelId: provider.defaultModelId,
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
    // Resolve the requested model against what the provider offers, falling back to its default; this
    // guards against a stale or unknown id arriving from the renderer.
    const model: string = provider.models.some(
      (candidate: AiModelInfo): boolean => candidate.id === request.model,
    )
      ? request.model
      : provider.defaultModelId;
    // Validate the posture and clamp the token cap; the request comes from the renderer.
    const permissionPosture: AiPermissionPosture = PERMISSION_POSTURES.includes(
      request.permissionPosture,
    )
      ? request.permissionPosture
      : 'prompt';
    const tokenCap: number =
      typeof request.tokenCap === 'number' && request.tokenCap > 0
        ? Math.floor(request.tokenCap)
        : 0;
    const mode: AgentMode = request.mode === 'chat' ? 'chat' : 'agent';
    const contextPaths: readonly AgentContextRef[] = this.sanitizeContextPaths(
      request.contextPaths,
    );
    const controller: AbortController = new AbortController();
    this.runs.set(request.requestId, controller);
    const context: AgentRunContext = {
      requestId: request.requestId,
      prompt: request.prompt,
      workspaceRoot: request.workspaceRoot,
      model,
      permissionPosture,
      tokenCap,
      owningTabId: request.owningTabId ?? null,
      surface: request.surface ?? 'editor',
      mode,
      contextPaths,
      resumeSessionId:
        typeof request.resumeSessionId === 'string' && request.resumeSessionId.length > 0
          ? request.resumeSessionId
          : null,
      auth: this.currentAuth(),
      signal: controller.signal,
      bridge: {
        request: (capability: string, input: unknown): Promise<unknown> =>
          this.bridge.request(capability, input),
      },
      requestPermission: (name: string, detail: string): Promise<boolean> =>
        this.requestPermission(request.requestId, controller.signal, name, detail),
      requestInput: (question: string, choices: readonly AiInputChoice[]): Promise<string | null> =>
        this.requestInput(request.requestId, controller.signal, question, choices),
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
        this.finish(
          request.requestId,
          'error',
          error instanceof Error ? error.message : String(error),
        ),
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
    this.windowGetter()?.webContents.send(AiChannel.Event, event);
  }

  /**
   * Asks the user to permit a gated action by emitting a permission event and awaiting the renderer's
   * answer. Resolves to false if the run aborts before the user answers.
   * @param requestId The run the prompt belongs to.
   * @param signal The run's abort signal.
   * @param name The display name of the action.
   * @param detail A one-line summary of the action.
   * @returns Returns true when the user grants permission.
   */
  private requestPermission(
    requestId: string,
    signal: AbortSignal,
    name: string,
    detail: string,
  ): Promise<boolean> {
    const permissionId: string = randomUUID();
    return new Promise<boolean>((resolve: (granted: boolean) => void): void => {
      const settle: (granted: boolean) => void = (granted: boolean): void => {
        if (this.permissions.delete(permissionId)) {
          resolve(granted);
        }
      };
      this.permissions.set(permissionId, settle);
      if (signal.aborted) {
        settle(false);
        return;
      }
      signal.addEventListener('abort', (): void => settle(false), { once: true });
      this.emit({ requestId, kind: 'permission', permissionId, name, detail });
    });
  }

  /**
   * Resolves the pending permission prompt matching a reply.
   * @param reply The renderer's reply.
   */
  private resolvePermission(reply: AiPermissionReply): void {
    this.permissions.get(reply.permissionId)?.(reply.granted);
  }

  /**
   * Asks the user a question on the agent's behalf by emitting an input-request event and awaiting the
   * renderer's answer. Resolves to null if the user declines to answer or the run aborts first.
   * @param requestId The run the question belongs to.
   * @param signal The run's abort signal.
   * @param question The question the agent is asking.
   * @param choices The suggested answers, or empty for a free-form question.
   * @returns Returns the user's answer, or null when they declined.
   */
  private requestInput(
    requestId: string,
    signal: AbortSignal,
    question: string,
    choices: readonly AiInputChoice[],
  ): Promise<string | null> {
    const inputId: string = randomUUID();
    return new Promise<string | null>((resolve: (answer: string | null) => void): void => {
      const settle: (answer: string | null) => void = (answer: string | null): void => {
        if (this.inputs.delete(inputId)) {
          resolve(answer);
        }
      };
      this.inputs.set(inputId, settle);
      if (signal.aborted) {
        settle(null);
        return;
      }
      signal.addEventListener('abort', (): void => settle(null), { once: true });
      this.emit({ requestId, kind: 'input-request', inputId, question, choices });
    });
  }

  /**
   * Resolves the pending input request matching a reply.
   * @param reply The renderer's reply.
   */
  private resolveInput(reply: AiInputReply): void {
    this.inputs.get(reply.inputId)?.(reply.answer);
  }

  /**
   * Narrows an untrusted IPC payload to a {@link AiInputReply}.
   * @param value The payload.
   * @returns Returns true when the payload has the required shape.
   */
  private isInputReply(value: unknown): value is AiInputReply {
    if (value === null || typeof value !== 'object') {
      return false;
    }
    const record: Record<string, unknown> = value as Record<string, unknown>;
    return (
      typeof record['inputId'] === 'string' &&
      (typeof record['answer'] === 'string' || record['answer'] === null)
    );
  }

  /**
   * Narrows an untrusted IPC payload to a {@link AiPermissionReply}.
   * @param value The payload.
   * @returns Returns true when the payload has the required shape.
   */
  private isPermissionReply(value: unknown): value is AiPermissionReply {
    if (value === null || typeof value !== 'object') {
      return false;
    }
    const record: Record<string, unknown> = value as Record<string, unknown>;
    return typeof record['permissionId'] === 'string' && typeof record['granted'] === 'boolean';
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
      typeof record['prompt'] === 'string' &&
      (typeof record['workspaceRoot'] === 'string' || record['workspaceRoot'] === null) &&
      (typeof record['owningTabId'] === 'string' ||
        record['owningTabId'] === null ||
        record['owningTabId'] === undefined) &&
      (record['surface'] === 'editor' ||
        record['surface'] === 'terminal' ||
        record['surface'] === 'binary' ||
        record['surface'] === 'project' ||
        record['surface'] === undefined) &&
      (record['mode'] === 'agent' || record['mode'] === 'chat' || record['mode'] === undefined) &&
      (record['contextPaths'] === undefined || Array.isArray(record['contextPaths']))
    );
  }

  /**
   * Validates and normalises the attached context references from an untrusted run request, dropping
   * any entry that is not a well-formed `{ path, kind }` pair.
   * @param value The untrusted `contextPaths` value.
   * @returns Returns the sanitised references (empty when none are valid).
   */
  private sanitizeContextPaths(value: unknown): readonly AgentContextRef[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value.filter((entry: unknown): entry is AgentContextRef => {
      if (entry === null || typeof entry !== 'object') {
        return false;
      }
      const record: Record<string, unknown> = entry as Record<string, unknown>;
      return (
        typeof record['path'] === 'string' &&
        record['path'].length > 0 &&
        (record['kind'] === 'file' || record['kind'] === 'folder')
      );
    });
  }
}
