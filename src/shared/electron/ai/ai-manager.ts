import { randomUUID } from 'node:crypto';
import { app, BrowserWindow, ipcMain, IpcMainEvent, IpcMainInvokeEvent } from 'electron';
import type {
  AgentContextRef,
  AgentMode,
  AiConnection,
  AiDiscoverModelsRequest,
  AiDiscoverModelsResult,
  AiEditDecisionReply,
  AiEvent,
  AiImageRef,
  AiInputChoice,
  AiInputReply,
  AiModelInfo,
  AiPermissionPosture,
  AiPermissionReply,
  AiProviderInfo,
  AiRunRequest,
  AiToolPolicy,
  AiRunState,
  AiSteerRequest,
} from '@shared/api/ai-types';
import { SEED_CONNECTIONS } from '@shared/api/ai-types';

/**
 * The permission postures accepted from the renderer, used to validate the untrusted run request.
 */
const PERMISSION_POSTURES: readonly AiPermissionPosture[] = ['prompt', 'auto-edits', 'auto-all'];
import { AiChannel } from '@shared/api/ai-channels';
import type {
  AgentAuth,
  AgentProvider,
  AgentRunContext,
  EditDecisionOutcome,
  ProviderAvailability,
} from './agent-provider';
import { AiAuthManager } from './ai-auth-manager';
import { AiSdkAdapter } from './ai-sdk-adapter';
import { isConnection, sanitizeConnections } from './connection-guard';
import { AgentAuditLog, type AuditGrantSource } from './agent-audit-log';
import { ClaudeAgentProvider } from './claude-agent-provider';
import { sanitizeToolPolicies } from './tool-policy';
import { sanitizeWritePaths } from './write-confinement';
import { type HttpFetch, runDiscovery } from './model-discovery';
import { PermissionRuleStore } from './permission-rule-store';
import { RendererBridge } from './renderer-bridge';

/**
 * A pending permission prompt: the resolver, plus the tool and workspace the request was for so a
 * remembered grant can be recorded when the reply arrives.
 */
interface PendingPermission {
  /**
   * Settles the prompt.
   */
  readonly settle: (granted: boolean) => void;

  /**
   * Gets the display name of the tool that asked.
   */
  readonly name: string;

  /**
   * Gets the workspace root of the asking run, or null for none.
   */
  readonly workspaceRoot: string | null;
}

/**
 * The result of building providers from a set of connections: the provider map keyed by connection id
 * and the connection map the run path resolves credentials through.
 */
interface BuiltProviders {
  /**
   * Gets the registered providers, keyed by connection id.
   */
  readonly providers: Map<string, AgentProvider>;

  /**
   * Gets the connections the providers were built from, keyed by connection id.
   */
  readonly connections: Map<string, AiConnection>;
}

/**
 * Caps a run's wall-clock budget at two hours, bounding an untrusted request.
 */
const MAX_RUN_TIMEOUT_MS: number = 7_200_000;

/**
 * The wall-clock budget of a run: the time remaining, the armed timer, and the pause depth (several
 * user prompts can overlap when parallel sub-agents ask concurrently — the clock resumes when the
 * last one settles).
 */
interface RunClock {
  /**
   * Gets the configured limit (for the timeout message).
   */
  readonly limitMs: number;

  /**
   * The budget left when the clock was last (re)armed.
   */
  remainingMs: number;

  /**
   * When the running timer was armed (epoch ms), or 0 while paused.
   */
  armedAt: number;

  /**
   * The armed timeout, or null while paused.
   */
  timer: NodeJS.Timeout | null;

  /**
   * How many user prompts currently hold the clock paused.
   */
  pauseDepth: number;
}

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
   * Holds the registered providers, keyed by connection id. Rebuilt from the user's connections each
   * time the renderer lists providers, so the user's own connections become runnable.
   */
  private providers: Map<string, AgentProvider>;

  /**
   * Holds the connections the providers were built from, keyed by connection id, so a run resolves the
   * per-connection credential (its auth kind) and the run path stays connection-driven.
   */
  private connections: Map<string, AiConnection>;

  /**
   * Holds the HTTP fetch used for model discovery (the main-process global fetch), referenced through
   * `globalThis` so this module carries no ambient fetch-type dependency.
   */
  private readonly httpFetch: HttpFetch = (
    url: string,
    init?: { headers?: Record<string, string> },
  ): ReturnType<HttpFetch> => (globalThis as unknown as { fetch: HttpFetch }).fetch(url, init);

  /**
   * Holds the abort controllers of in-flight runs, keyed by request id.
   */
  private readonly runs: Map<string, AbortController> = new Map<string, AbortController>();

  /**
   * Holds the bridge to the renderer's in-app capabilities.
   */
  private readonly bridge: RendererBridge;

  /**
   * Holds the pending permission prompts, keyed by permission id.
   */
  private readonly permissions: Map<string, PendingPermission> = new Map<
    string,
    PendingPermission
  >();

  /**
   * Holds the persisted permission rules (the broker's workspace/always grants).
   */
  private readonly rules: PermissionRuleStore = new PermissionRuleStore();

  /**
   * Holds the append-only audit log of granted agent actions (#308), created lazily on first grant so
   * `app.getPath` is only read once Electron is ready.
   */
  private auditLog: AgentAuditLog | null = null;

  /**
   * Holds the tools granted for the rest of this app session, dying with the process.
   */
  private readonly sessionAllowed: Set<string> = new Set<string>();

  /**
   * Holds the resolvers of pending edit-decision prompts, keyed by decision id.
   */
  private readonly editDecisions: Map<string, (choice: EditDecisionOutcome) => void> = new Map<
    string,
    (choice: EditDecisionOutcome) => void
  >();

  /**
   * Tracks whether the user chose to auto-accept edit previews for the rest of this app session
   * ("Yes, and automatically accept edits"). Dies with the process.
   */
  private autoAcceptEdits: boolean = false;

  /**
   * Holds the resolvers of pending input requests (agent questions), keyed by input id.
   */
  private readonly inputs: Map<string, (answer: string | null) => void> = new Map<
    string,
    (answer: string | null) => void
  >();

  /**
   * Holds the mid-run steering handlers of in-flight runs that accept injected user messages, keyed
   * by request id. Only providers with streaming input register one (the Claude Agent SDK); a steer
   * request for a run with no handler is refused so the renderer queues the message instead.
   */
  private readonly steers: Map<string, (text: string) => boolean> = new Map<
    string,
    (text: string) => boolean
  >();

  /**
   * Holds the wall-clock budgets of in-flight runs that have one, keyed by request id.
   */
  private readonly clocks: Map<string, RunClock> = new Map<string, RunClock>();

  /**
   * Holds the runs whose wall-clock budget expired, so their abort lands as a structured timeout
   * error rather than a plain stop.
   */
  private readonly timedOut: Set<string> = new Set<string>();

  /**
   * Initializes a new instance of the {@link AiManager} class.
   * @param windowGetter A function that returns the window agent events are sent to.
   */
  public constructor(windowGetter: () => BrowserWindow | null) {
    this.windowGetter = windowGetter;
    this.bridge = new RendererBridge(windowGetter);

    // Seed the subsystem so it is runnable before the renderer has listed its connections; the first
    // `listProviders` call replaces these with the user's own connections (which default to the same
    // seeds on a fresh install but are fully editable — including removing every one).
    const built: BuiltProviders = this.buildProviders(SEED_CONNECTIONS);
    this.providers = built.providers;
    this.connections = built.connections;
  }

  /**
   * Builds one provider per connection: a `claude-login` connection runs through the Claude Agent SDK
   * (the local-login, deeply-agentic path); every other connection runs through the generic AI-SDK
   * adapter, configured by the connection's kind and endpoint. Whatever connections the user configures
   * are built exactly as given — none is privileged, and an empty list yields no providers.
   * @param connections The connections to build providers from.
   * @returns Returns the built provider map and connection map.
   */
  private buildProviders(connections: readonly AiConnection[]): BuiltProviders {
    const providers: Map<string, AgentProvider> = new Map<string, AgentProvider>();
    for (const connection of connections) {
      if (connection.auth === 'claude-login') {
        providers.set(
          connection.id,
          new ClaudeAgentProvider(connection.models, connection.defaultModelId),
        );
      } else {
        providers.set(connection.id, new AiSdkAdapter(connection));
      }
    }
    return {
      providers,
      connections: new Map<string, AiConnection>(
        connections.map((connection: AiConnection): [string, AiConnection] => [
          connection.id,
          connection,
        ]),
      ),
    };
  }

  /**
   * Rebuilds the providers from exactly the user's connections (adding, editing, or removing any of
   * them is honoured verbatim — no connection is re-seeded). Provider instances hold no cross-run state
   * (sessions resume via the per-run session id), so rebuilding wholesale is safe and never disturbs an
   * in-flight run, which owns its own abort controller and executing promise.
   * @param connections The user's connections.
   */
  private rebuildProviders(connections: readonly AiConnection[]): void {
    const built: BuiltProviders = this.buildProviders(connections);
    this.providers = built.providers;
    this.connections = built.connections;
  }

  /**
   * Registers the agent IPC handlers (per-connection auth, provider listing, and run/abort).
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
    ipcMain.on(AiChannel.EditDecisionReply, (_event: IpcMainEvent, reply: unknown): void => {
      if (this.isEditDecisionReply(reply)) {
        this.resolveEditDecision(reply);
      }
    });
    ipcMain.handle(
      AiChannel.ListProviders,
      (_event: IpcMainInvokeEvent, connections: unknown): readonly AiProviderInfo[] =>
        this.listProviders(sanitizeConnections(connections)),
    );
    ipcMain.handle(
      AiChannel.DiscoverModels,
      (_event: IpcMainInvokeEvent, request: unknown): Promise<AiDiscoverModelsResult> =>
        this.isDiscoverModelsRequest(request)
          ? this.discoverModels(request.connection)
          : Promise.resolve({
              ok: false,
              models: [],
              added: 0,
              detail: 'Invalid discovery request.',
            }),
    );
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
    ipcMain.handle(AiChannel.Steer, (_event: IpcMainInvokeEvent, request: unknown): boolean => {
      if (!this.isSteerRequest(request)) {
        return false;
      }
      return this.steers.get(request.requestId)?.(request.text) ?? false;
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
    for (const requestId of [...this.clocks.keys()]) {
      this.dropClock(requestId);
    }
  }

  /**
   * Resolves the credential material for a connection from its auth kind.
   * @param connectionId The connection id.
   * @returns Returns the {@link AgentAuth}.
   */
  private authForConnection(connectionId: string): AgentAuth {
    const connection: AiConnection | undefined = this.connections.get(connectionId);
    return connection === undefined
      ? { hasLocalLogin: this.auth.hasLocalLogin(), apiKey: null }
      : this.auth.authFor(connectionId, connection.auth);
  }

  /**
   * Rebuilds the providers from the user's connections, then lists them and their current availability
   * (resolved per connection).
   * @param connections The user's connections.
   * @returns Returns the provider descriptors.
   */
  private listProviders(connections: readonly AiConnection[]): readonly AiProviderInfo[] {
    this.rebuildProviders(connections);
    const infos: AiProviderInfo[] = [];
    for (const connection of this.connections.values()) {
      const provider: AgentProvider | undefined = this.providers.get(connection.id);
      if (provider === undefined) {
        continue;
      }
      const availability: ProviderAvailability = provider.describeAvailability(
        this.authForConnection(connection.id),
      );
      infos.push({
        id: connection.id,
        label: provider.label,
        available: availability.available,
        detail: availability.detail,
        models: provider.models,
        defaultModelId: provider.defaultModelId,
        supportsImages: provider.supportsImages,
      });
    }
    return infos;
  }

  /**
   * Discovers a connection's models from its `/models` endpoint, resolving the connection's credential
   * by id, and returns the merged list (or the existing list unchanged when discovery cannot run).
   * @param connection The connection to discover models for.
   * @returns Returns the discovery result.
   */
  private discoverModels(connection: AiConnection): Promise<AiDiscoverModelsResult> {
    const apiKey: string | null = this.auth.authFor(connection.id, connection.auth).apiKey;
    return runDiscovery(connection, apiKey, process.env, this.httpFetch);
  }

  /**
   * Determines whether a value is a well-formed discover-models request (its connection carries the
   * fields discovery reads).
   * @param value The value to test.
   * @returns Returns true when the value is a discover-models request.
   */
  private isDiscoverModelsRequest(value: unknown): value is AiDiscoverModelsRequest {
    if (typeof value !== 'object' || value === null || !('connection' in value)) {
      return false;
    }
    return isConnection(value.connection);
  }

  /**
   * Starts an agent turn, streaming its events to the renderer.
   * @param request The run request.
   */
  private run(request: AiRunRequest): void {
    const provider: AgentProvider | undefined = this.providers.get(request.providerId);
    const connection: AiConnection | undefined = this.connections.get(request.providerId);
    if (provider === undefined || connection === undefined) {
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
    const toolPolicies: Readonly<Record<string, AiToolPolicy>> = sanitizeToolPolicies(
      request.toolPolicies,
    );
    const allowedWritePaths: readonly string[] = sanitizeWritePaths(
      request.allowedWritePaths,
      true,
    );
    const deniedWritePaths: readonly string[] = sanitizeWritePaths(request.deniedWritePaths, false);
    const tokenCap: number =
      typeof request.tokenCap === 'number' && request.tokenCap > 0
        ? Math.floor(request.tokenCap)
        : 0;
    const mode: AgentMode = request.mode === 'chat' ? 'chat' : 'agent';
    const contextPaths: readonly AgentContextRef[] = this.sanitizeContextPaths(
      request.contextPaths,
    );
    // Images only reach providers that declared image support; the composer rejects them earlier,
    // this is the backstop for an untrusted request.
    const images: readonly AiImageRef[] = provider.supportsImages
      ? this.sanitizeImages(request.images)
      : [];
    const controller: AbortController = new AbortController();
    this.runs.set(request.requestId, controller);
    // Arm the wall-clock budget when one is set; expiry aborts through the ordinary abort path and
    // finish() turns the stop into a structured timeout error.
    const runTimeoutMs: number =
      typeof request.runTimeoutMs === 'number' && Number.isFinite(request.runTimeoutMs)
        ? Math.min(Math.max(Math.floor(request.runTimeoutMs), 0), MAX_RUN_TIMEOUT_MS)
        : 0;
    if (runTimeoutMs > 0) {
      this.startClock(request.requestId, runTimeoutMs, controller);
    }
    const context: AgentRunContext = {
      requestId: request.requestId,
      prompt: request.prompt,
      workspaceRoot: request.workspaceRoot,
      model,
      permissionPosture,
      toolPolicies,
      allowedWritePaths,
      deniedWritePaths,
      tokenCap,
      owningTabId: request.owningTabId ?? null,
      surface: request.surface ?? 'editor',
      mode,
      contextPaths,
      images,
      resumeSessionId:
        typeof request.resumeSessionId === 'string' && request.resumeSessionId.length > 0
          ? request.resumeSessionId
          : null,
      resumeSessionAt:
        typeof request.resumeSessionAt === 'string' && request.resumeSessionAt.length > 0
          ? request.resumeSessionAt
          : null,
      forkSession: request.forkSession === true,
      auth: this.authForConnection(connection.id),
      signal: controller.signal,
      bridge: {
        request: (capability: string, input: unknown, timeoutMs?: number): Promise<unknown> =>
          this.bridge.request(capability, input, timeoutMs),
      },
      requestPermission: (name: string, detail: string): Promise<boolean> =>
        this.requestPermission(
          request.requestId,
          controller.signal,
          request.workspaceRoot,
          name,
          detail,
        ),
      recordAudit: (name: string, detail: string, source: AuditGrantSource): void =>
        this.recordAudit(name, detail, request.workspaceRoot, source),
      requestInput: (question: string, choices: readonly AiInputChoice[]): Promise<string | null> =>
        this.requestInput(request.requestId, controller.signal, question, choices),
      requestEditDecision: (
        name: string,
        detail: string,
        hasDiff: boolean,
      ): Promise<EditDecisionOutcome> =>
        this.requestEditDecision(request.requestId, controller.signal, name, detail, hasDiff),
      emit: (event: AiEvent): void => this.emit(event),
      setSteerHandler: (handler: ((text: string) => boolean) | null): void => {
        if (handler === null) {
          this.steers.delete(request.requestId);
        } else {
          this.steers.set(request.requestId, handler);
        }
      },
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
    this.steers.delete(requestId);
    const clock: RunClock | undefined = this.clocks.get(requestId);
    this.dropClock(requestId);
    // An expired budget aborted the run; land it as a structured timeout error so the renderer's
    // error card (with its retry) explains what happened.
    if (this.timedOut.delete(requestId)) {
      const minutes: number = clock === undefined ? 0 : Math.round(clock.limitMs / 60_000);
      this.emit({
        requestId,
        kind: 'status',
        state: 'error',
        detail: `The run exceeded its ${minutes === 1 ? '1-minute' : `${minutes}-minute`} time limit and was stopped.`,
      });
      return;
    }
    this.emit({ requestId, kind: 'status', state, detail });
  }

  /**
   * Arms a run's wall-clock budget; expiry marks the run timed out and aborts it.
   * @param requestId The run's identifier.
   * @param limitMs The budget in milliseconds.
   * @param controller The run's abort controller.
   */
  private startClock(requestId: string, limitMs: number, controller: AbortController): void {
    const clock: RunClock = {
      limitMs,
      remainingMs: limitMs,
      armedAt: 0,
      timer: null,
      pauseDepth: 0,
    };
    this.clocks.set(requestId, clock);
    this.armClock(requestId, clock, controller);
  }

  /**
   * Arms (or re-arms) a clock's timer for its remaining budget.
   * @param requestId The run's identifier.
   * @param clock The clock to arm.
   * @param controller The run's abort controller.
   */
  private armClock(requestId: string, clock: RunClock, controller: AbortController): void {
    clock.armedAt = Date.now();
    clock.timer = setTimeout((): void => {
      this.timedOut.add(requestId);
      controller.abort();
    }, clock.remainingMs);
  }

  /**
   * Pauses a run's clock while a user prompt is open (nested prompts stack; the clock resumes when
   * the last one settles). A run without a budget is unaffected.
   * @param requestId The run's identifier.
   */
  private pauseClock(requestId: string): void {
    const clock: RunClock | undefined = this.clocks.get(requestId);
    if (clock === undefined) {
      return;
    }
    clock.pauseDepth += 1;
    if (clock.pauseDepth === 1 && clock.timer !== null) {
      clearTimeout(clock.timer);
      clock.timer = null;
      clock.remainingMs = Math.max(0, clock.remainingMs - (Date.now() - clock.armedAt));
      clock.armedAt = 0;
    }
  }

  /**
   * Resumes a run's clock once a user prompt settles (the last of any overlapping prompts re-arms
   * the timer for the remaining budget).
   * @param requestId The run's identifier.
   */
  private resumeClock(requestId: string): void {
    const clock: RunClock | undefined = this.clocks.get(requestId);
    if (clock === undefined || clock.pauseDepth === 0) {
      return;
    }
    clock.pauseDepth -= 1;
    if (clock.pauseDepth === 0) {
      const controller: AbortController | undefined = this.runs.get(requestId);
      if (controller !== undefined) {
        this.armClock(requestId, clock, controller);
      }
    }
  }

  /**
   * Drops a run's clock, clearing any armed timer.
   * @param requestId The run's identifier.
   */
  private dropClock(requestId: string): void {
    const clock: RunClock | undefined = this.clocks.get(requestId);
    if (clock?.timer != null) {
      clearTimeout(clock.timer);
    }
    this.clocks.delete(requestId);
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
   * Asks the user to permit a gated action, first consulting the permission broker: a session grant
   * or a persisted workspace/always rule resolves immediately with no prompt. Otherwise a permission
   * event is emitted and the renderer's answer awaited. Resolves to false if the run aborts before
   * the user answers.
   * @param requestId The run the prompt belongs to.
   * @param signal The run's abort signal.
   * @param workspaceRoot The run's workspace root, or null for none.
   * @param name The display name of the action.
   * @param detail A one-line summary of the action.
   * @returns Returns true when the user grants permission (or a remembered rule already does).
   */
  private requestPermission(
    requestId: string,
    signal: AbortSignal,
    workspaceRoot: string | null,
    name: string,
    detail: string,
  ): Promise<boolean> {
    if (this.sessionAllowed.has(name) || this.rules.isAllowed(name, workspaceRoot)) {
      return Promise.resolve(true);
    }
    const permissionId: string = randomUUID();
    // The run is blocked on the user: its wall clock pauses until the prompt settles.
    this.pauseClock(requestId);
    return new Promise<boolean>((resolve: (granted: boolean) => void): void => {
      const settle: (granted: boolean) => void = (granted: boolean): void => {
        if (this.permissions.delete(permissionId)) {
          this.resumeClock(requestId);
          resolve(granted);
        }
      };
      this.permissions.set(permissionId, { settle, name, workspaceRoot });
      if (signal.aborted) {
        settle(false);
        return;
      }
      signal.addEventListener('abort', (): void => settle(false), { once: true });
      this.emit({
        requestId,
        kind: 'permission',
        permissionId,
        name,
        detail,
        hasWorkspace: workspaceRoot !== null,
      });
    });
  }

  /**
   * Records an executed mutating/exec action to the audit log (#308/#311), stamping the moment here so
   * the log stays a pure sink. Best-effort by construction (the log swallows its own IO errors).
   * @param name The tool's display name.
   * @param detail The one-line target summary.
   * @param workspaceRoot The run's workspace root, or null for none.
   * @param source The coarse reason the action was allowed.
   */
  private recordAudit(
    name: string,
    detail: string,
    workspaceRoot: string | null,
    source: AuditGrantSource,
  ): void {
    this.auditLog ??= new AgentAuditLog(app.getPath('userData'));
    this.auditLog.record({
      at: new Date().toISOString(),
      tool: name,
      target: detail,
      workspaceRoot,
      source,
    });
  }

  /**
   * Resolves the pending permission prompt matching a reply, recording a remembered grant with the
   * broker first. Only grants are remembered — a denial's remember scope is ignored.
   * @param reply The renderer's reply.
   */
  private resolvePermission(reply: AiPermissionReply): void {
    const pending: PendingPermission | undefined = this.permissions.get(reply.permissionId);
    if (pending === undefined) {
      return;
    }
    if (reply.granted && reply.remember !== undefined) {
      if (reply.remember === 'session') {
        this.sessionAllowed.add(pending.name);
      } else {
        this.rules.remember(pending.name, reply.remember, pending.workspaceRoot);
      }
    }
    pending.settle(reply.granted);
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
    // The run is blocked on the user: its wall clock pauses until the question settles.
    this.pauseClock(requestId);
    return new Promise<string | null>((resolve: (answer: string | null) => void): void => {
      const settle: (answer: string | null) => void = (answer: string | null): void => {
        if (this.inputs.delete(inputId)) {
          this.resumeClock(requestId);
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
   * Asks the user to decide on a staged edit preview by emitting an edit-decision event and awaiting
   * the renderer's answer — or resolves `yes` immediately while edits are auto-accepted for the
   * session. Resolves `no` if the run aborts before the user answers.
   * @param requestId The run the decision belongs to.
   * @param signal The run's abort signal.
   * @param name The display name of the document being edited.
   * @param detail A one-line summary of the staged change.
   * @param hasDiff Whether the staged change is showing as a diff in the document well.
   * @returns Returns the decision.
   */
  private requestEditDecision(
    requestId: string,
    signal: AbortSignal,
    name: string,
    detail: string,
    hasDiff: boolean,
  ): Promise<EditDecisionOutcome> {
    if (this.autoAcceptEdits) {
      return Promise.resolve('yes');
    }
    const decisionId: string = randomUUID();
    // The run is blocked on the user: its wall clock pauses until the decision settles.
    this.pauseClock(requestId);
    return new Promise<EditDecisionOutcome>(
      (resolve: (choice: EditDecisionOutcome) => void): void => {
        const settle: (choice: EditDecisionOutcome) => void = (
          choice: EditDecisionOutcome,
        ): void => {
          if (this.editDecisions.delete(decisionId)) {
            this.resumeClock(requestId);
            resolve(choice);
          }
        };
        this.editDecisions.set(decisionId, settle);
        if (signal.aborted) {
          settle('no');
          return;
        }
        signal.addEventListener('abort', (): void => settle('no'), { once: true });
        this.emit({ requestId, kind: 'edit-decision', decisionId, name, detail, hasDiff });
      },
    );
  }

  /**
   * Resolves the pending edit decision matching a reply, recording the session auto-accept flag
   * when the user chose "yes, and automatically accept edits".
   * @param reply The renderer's reply.
   */
  private resolveEditDecision(reply: AiEditDecisionReply): void {
    if (reply.choice === 'yes-auto') {
      this.autoAcceptEdits = true;
    }
    this.editDecisions.get(reply.decisionId)?.(reply.choice === 'no' ? 'no' : 'yes');
  }

  /**
   * Narrows an untrusted IPC payload to a {@link AiEditDecisionReply}.
   * @param value The payload.
   * @returns Returns true when the payload has the required shape.
   */
  private isEditDecisionReply(value: unknown): value is AiEditDecisionReply {
    if (value === null || typeof value !== 'object') {
      return false;
    }
    const record: Record<string, unknown> = value as Record<string, unknown>;
    return (
      typeof record['decisionId'] === 'string' &&
      (record['choice'] === 'yes' || record['choice'] === 'yes-auto' || record['choice'] === 'no')
    );
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
   * Narrows an untrusted IPC payload to a {@link AiSteerRequest}.
   * @param value The payload.
   * @returns Returns true when the payload has the required shape.
   */
  private isSteerRequest(value: unknown): value is AiSteerRequest {
    if (value === null || typeof value !== 'object') {
      return false;
    }
    const record: Record<string, unknown> = value as Record<string, unknown>;
    return (
      typeof record['requestId'] === 'string' &&
      typeof record['text'] === 'string' &&
      record['text'].length > 0
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
    return (
      typeof record['permissionId'] === 'string' &&
      typeof record['granted'] === 'boolean' &&
      (record['remember'] === undefined ||
        record['remember'] === 'session' ||
        record['remember'] === 'workspace' ||
        record['remember'] === 'always')
    );
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
      (record['contextPaths'] === undefined || Array.isArray(record['contextPaths'])) &&
      (record['images'] === undefined || Array.isArray(record['images'])) &&
      (record['runTimeoutMs'] === undefined || typeof record['runTimeoutMs'] === 'number')
    );
  }

  /**
   * Validates and normalises the attached images from an untrusted run request: only well-formed
   * base64 entries with an allowed media type survive, capped in count and per-image size.
   * @param value The untrusted `images` value.
   * @returns Returns the sanitised images (empty when none are valid).
   */
  private sanitizeImages(value: unknown): readonly AiImageRef[] {
    if (!Array.isArray(value)) {
      return [];
    }
    const allowedTypes: readonly string[] = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
    // ~6 MB of base64 (~4.5 MB of image) per image; the composer enforces a smaller cap already.
    const maxDataLength: number = 6_000_000;
    return value
      .filter((entry: unknown): entry is AiImageRef => {
        if (entry === null || typeof entry !== 'object') {
          return false;
        }
        const record: Record<string, unknown> = entry as Record<string, unknown>;
        return (
          typeof record['mediaType'] === 'string' &&
          allowedTypes.includes(record['mediaType']) &&
          typeof record['data'] === 'string' &&
          record['data'].length > 0 &&
          record['data'].length <= maxDataLength &&
          /^[A-Za-z0-9+/=]+$/.test(record['data']) &&
          (record['name'] === undefined || typeof record['name'] === 'string')
        );
      })
      .slice(0, 6);
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
    // Selection content is inlined into the prompt, so its size is bounded here.
    const maxSelectionChars: number = 200_000;
    return value
      .filter((entry: unknown): entry is AgentContextRef => {
        if (entry === null || typeof entry !== 'object') {
          return false;
        }
        const record: Record<string, unknown> = entry as Record<string, unknown>;
        if (typeof record['path'] !== 'string' || record['path'].length === 0) {
          return false;
        }
        if (record['kind'] === 'file' || record['kind'] === 'folder') {
          return true;
        }
        return (
          record['kind'] === 'selection' &&
          typeof record['content'] === 'string' &&
          record['content'].length > 0 &&
          record['content'].length <= maxSelectionChars
        );
      })
      .map(
        (ref: AgentContextRef): AgentContextRef =>
          // Content rides only on selections; strip any stray payload from path references.
          ref.kind === 'selection' ? ref : { path: ref.path, kind: ref.kind },
      );
  }
}
