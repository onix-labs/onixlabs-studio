import { BrowserWindow, ipcMain, IpcMainEvent, IpcMainInvokeEvent } from 'electron';
import { ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { statSync } from 'node:fs';
import { logger } from '../logger';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  createMessageConnection,
  MessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
} from 'vscode-jsonrpc/node';
import type {
  ClientCapabilities,
  InitializeParams,
  InitializeResult,
} from 'vscode-languageserver-protocol';
import {
  LspChannel,
  LspExit,
  LspMessage,
  LspStartRequest,
  LspStartResult,
  SEMANTIC_TOKEN_MODIFIERS,
  SEMANTIC_TOKEN_TYPES,
} from '@shared/api/lsp-channels';
import { pidJournal } from '../pid-journal';
import { detachedSpawnOptions, killProcessTree } from '../process-tree';
import { WorkspaceContext } from '../workspace-context';
import { LspResolution, LspServerRegistry, LspServerSpec } from './lsp-server-registry';

/**
 * Specifies how long, in milliseconds, to wait for a server's `initialize` response before giving up
 * and tearing the session down. Heavy servers (jdtls warming a JVM, Roslyn restoring a solution on a
 * cold start) can legitimately take well over twenty seconds, so this errs long: a slow-but-alive
 * server that gets torn down mid-handshake would otherwise be re-spawned only to time out again.
 */
const INITIALIZE_TIMEOUT_MS: number = 60000;

/**
 * Specifies how long, in milliseconds, to wait for a server's `shutdown` response when a session is
 * stopped. Deliberately much shorter than the initialize timeout: a stop happens because the user
 * closed a tab or workspace, and a server busy loading a large solution may not answer until the load
 * finishes — the session must not keep burning CPU for up to a minute after its consumer is gone. The
 * kill that follows escalates to SIGKILL on its own grace period.
 */
const SHUTDOWN_TIMEOUT_MS: number = 3000;

/**
 * The server notifications forwarded to the renderer — exactly the set the renderer's client
 * handles. Everything else (progress, telemetry, server-specific chatter) is dropped here, before it
 * costs an IPC hop.
 */
const FORWARDED_NOTIFICATIONS: ReadonlySet<string> = new Set<string>([
  'textDocument/publishDiagnostics',
  'workspace/projectInitializationComplete',
  'workspace/semanticTokens/refresh',
  'window/logMessage',
  'window/showMessage',
]);

/**
 * Holds a running language-server session: its message connection, child process, and workspace root.
 */
interface LspSession {
  /**
   * Holds the JSON-RPC connection to the server over its standard streams.
   */
  readonly connection: MessageConnection;

  /**
   * Holds the spawned server process.
   */
  readonly child: ChildProcessWithoutNullStreams;

  /**
   * Holds the absolute workspace root the server is rooted at.
   */
  readonly rootPath: string;

  /**
   * Holds how many renderer clients are using this session. Several surfaces can open the same root
   * (two tabs on one folder, a docked and a standalone editor): each Start increments, each Stop
   * decrements, and the server is only torn down when the count reaches zero — one surface closing
   * must not kill the server another is still using.
   */
  refCount: number;

  /**
   * Holds the outcome of the session's initialize handshake, shared with every client that starts
   * the same session — a deduplicated Start must receive the real capabilities, not a bare success
   * (a client without capabilities silently loses pull diagnostics and semantic tokens).
   */
  ready: Promise<LspStartResult>;
}

/**
 * Manages language-server sessions for the renderer. The main process owns each server's lifecycle:
 * it resolves the executable from a registry (never from the renderer), spawns it, runs the LSP
 * `initialize`/`initialized` handshake, answers the server-to-client requests a server needs to
 * proceed, and forwards diagnostics and other notifications to the renderer. The renderer drives
 * document synchronisation and language features by forwarding LSP notifications and requests. One
 * instance is owned by the main process.
 */
export class LspManager {
  /**
   * Holds the function used to resolve the window that server notifications are sent to.
   */
  private readonly windowGetter: () => BrowserWindow | null;

  /**
   * Holds the open-workspace tracker used to confine sessions to opened roots.
   */
  private readonly workspaceContext: WorkspaceContext;

  /**
   * Holds the registry that resolves a server identifier into a spawn specification.
   */
  private readonly registry: LspServerRegistry;

  /**
   * Holds the running sessions, keyed by session identifier.
   */
  private readonly sessions: Map<string, LspSession> = new Map<string, LspSession>();

  /**
   * Initializes a new instance of the {@link LspManager} class.
   * @param windowGetter A function that returns the window server notifications are sent to.
   * @param workspaceContext The open-workspace tracker used to confine sessions to opened roots.
   * @param registry The registry that resolves server identifiers into spawn specifications.
   */
  public constructor(
    windowGetter: () => BrowserWindow | null,
    workspaceContext: WorkspaceContext,
    registry: LspServerRegistry,
  ) {
    this.windowGetter = windowGetter;
    this.workspaceContext = workspaceContext;
    this.registry = registry;
  }

  /**
   * Registers the language-server IPC handlers.
   */
  public register(): void {
    ipcMain.handle(
      LspChannel.Start,
      (_event: IpcMainInvokeEvent, request: unknown): Promise<LspStartResult> =>
        this.start(request),
    );
    ipcMain.handle(
      LspChannel.Stop,
      (_event: IpcMainInvokeEvent, id: unknown): Promise<void> =>
        typeof id === 'string' ? this.stop(id) : Promise.resolve(),
    );
    ipcMain.handle(
      LspChannel.Request,
      (
        _event: IpcMainInvokeEvent,
        id: unknown,
        method: unknown,
        params: unknown,
      ): Promise<unknown> => this.request(id, method, params),
    );
    ipcMain.on(
      LspChannel.Notify,
      (_event: IpcMainEvent, id: unknown, method: unknown, params: unknown): void =>
        this.notify(id, method, params),
    );
  }

  /**
   * Disposes every running session. Called on application shutdown.
   */
  public disposeAll(): void {
    for (const id of [...this.sessions.keys()]) {
      this.tearDown(id);
    }
  }

  /**
   * Starts a session: validates the request, resolves and spawns the server, and runs the
   * `initialize`/`initialized` handshake.
   * @param request The start request from the renderer.
   * @returns Returns the start outcome, including server capabilities on success.
   */
  private async start(request: unknown): Promise<LspStartResult> {
    const parsed: LspStartRequest | null = this.parseStartRequest(request);
    if (parsed === null) {
      return { success: false, error: 'Invalid start request' };
    }
    const existing: LspSession | undefined = this.sessions.get(parsed.sessionId);
    if (existing !== undefined) {
      existing.refCount += 1;
      return existing.ready;
    }
    if (!this.isAllowedRoot(parsed)) {
      return { success: false, error: 'Workspace root is not open' };
    }
    const resolution: LspResolution = await this.registry.resolve(parsed.serverId, parsed.rootPath);
    const spec: LspServerSpec | null = resolution.spec;
    if (spec === null) {
      return {
        success: false,
        error: resolution.error ?? `Unknown or unavailable server: ${parsed.serverId}`,
      };
    }

    let child: ChildProcessWithoutNullStreams;
    try {
      // Own process group, so tearing down reaches the server's children too (Roslyn's MSBuild
      // BuildHost workers, jdtls's forked JVMs) — not just the server itself.
      child = spawn(spec.command, [...spec.args], {
        cwd: parsed.rootPath,
        env: { ...process.env, ...spec.env },
        stdio: ['pipe', 'pipe', 'pipe'],
        ...detachedSpawnOptions(),
      });
    } catch (error: unknown) {
      logger.error('LspManager', `Failed to spawn LSP server ${spec.command}`, error);
      return { success: false, error: error instanceof Error ? error.message : 'Spawn failed' };
    }
    pidJournal()?.register(child.pid, 'lsp', spec.command);
    logger.info('LspManager', `Started LSP server ${spec.command} (pid ${child.pid})`);
    // Drain stderr so a chatty server cannot stall on a full pipe; its contents are diagnostic only.
    child.stderr.resume();

    const connection: MessageConnection = createMessageConnection(
      new StreamMessageReader(child.stdout),
      new StreamMessageWriter(child.stdin),
    );
    this.answerServerRequests(connection, parsed.sessionId);
    connection.onNotification((method: string, params: unknown): void =>
      this.forwardNotification(parsed.sessionId, method, params),
    );
    child.on('exit', (code: number | null, signal: NodeJS.Signals | null): void =>
      this.handleExit(parsed.sessionId, code, signal),
    );
    connection.listen();

    const session: LspSession = {
      connection,
      child,
      rootPath: parsed.rootPath,
      refCount: 1,
      ready: Promise.resolve({ success: false, error: 'Initialize pending' }),
    };
    this.sessions.set(parsed.sessionId, session);

    // The handshake outcome (capabilities included) is retained on the session, so a concurrent or
    // later Start for the same session shares the real result instead of a capability-less success.
    session.ready = this.initialize(connection, parsed.rootPath, spec)
      .then(
        (result: InitializeResult): LspStartResult => ({
          success: true,
          serverInfo: result.serverInfo,
          capabilities: result.capabilities,
        }),
      )
      .catch((error: unknown): LspStartResult => {
        logger.warn('LspManager', `LSP server ${spec.command} failed to initialize`, error);
        this.tearDown(parsed.sessionId);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Initialize failed',
        };
      });
    return session.ready;
  }

  /**
   * Runs the `initialize` request (bounded by a timeout) followed by the `initialized` notification.
   * @param connection The server connection.
   * @param rootPath The absolute workspace root.
   * @param spec The server specification, supplying initialization options.
   * @returns Returns the server's initialize result.
   */
  private async initialize(
    connection: MessageConnection,
    rootPath: string,
    spec: LspServerSpec,
  ): Promise<InitializeResult> {
    const rootUri: string = pathToFileURL(rootPath).href;
    const params: InitializeParams = {
      processId: process.pid,
      rootUri,
      workspaceFolders: [{ uri: rootUri, name: rootPath }],
      initializationOptions: spec.initializationOptions,
      capabilities: this.clientCapabilities(),
    };
    const result: InitializeResult = await this.withTimeout<InitializeResult>(
      connection.sendRequest('initialize', params),
      INITIALIZE_TIMEOUT_MS,
    );
    void connection.sendNotification('initialized', {});
    // A server that does not load a workspace from `rootUri` alone (such as the Roslyn C# server) is
    // told which solution or project to open here, once the handshake has completed.
    for (const message of spec.postInitialize ?? []) {
      void connection.sendNotification(message.method, message.params);
    }
    return result;
  }

  /**
   * Sends an LSP request to a session's server and awaits its response.
   * @param id The session identifier.
   * @param method The LSP method name.
   * @param params The method parameters.
   * @returns Returns the server's result, or rejects when the session or arguments are invalid or the
   * server reports an error.
   */
  private request(id: unknown, method: unknown, params: unknown): Promise<unknown> {
    if (typeof id !== 'string' || typeof method !== 'string' || method.length === 0) {
      return Promise.reject(new Error('Invalid request'));
    }
    const session: LspSession | undefined = this.sessions.get(id);
    if (session === undefined) {
      return Promise.reject(new Error('No such session'));
    }
    return session.connection.sendRequest(method, params);
  }

  /**
   * Sends an LSP notification to a session's server. Does nothing when the session or arguments are
   * invalid.
   * @param id The session identifier.
   * @param method The LSP method name.
   * @param params The method parameters.
   */
  private notify(id: unknown, method: unknown, params: unknown): void {
    if (typeof id !== 'string' || typeof method !== 'string' || method.length === 0) {
      return;
    }
    const session: LspSession | undefined = this.sessions.get(id);
    if (session === undefined) {
      return;
    }
    void session.connection.sendNotification(method, params);
  }

  /**
   * Stops a session on behalf of one client: the reference count decrements, and only when the last
   * client stops is the server asked to shut down and torn down — other surfaces sharing the session
   * keep their working server.
   * @param id The session identifier.
   * @returns Returns a promise that resolves once the stop has been applied.
   */
  private async stop(id: string): Promise<void> {
    const session: LspSession | undefined = this.sessions.get(id);
    if (session === undefined) {
      return;
    }
    session.refCount -= 1;
    if (session.refCount > 0) {
      return;
    }
    try {
      await this.withTimeout(session.connection.sendRequest('shutdown'), SHUTDOWN_TIMEOUT_MS);
      void session.connection.sendNotification('exit');
    } catch {
      // The server is being killed regardless; ignore a failed graceful shutdown.
    }
    this.tearDown(id);
  }

  /**
   * Handles a server process exiting: notifies the renderer and tears the session down.
   * @param id The session identifier.
   * @param code The process exit code, or null when terminated by a signal.
   * @param signal The terminating signal, or null when exited normally.
   */
  private handleExit(id: string, code: number | null, signal: NodeJS.Signals | null): void {
    if (!this.sessions.has(id)) {
      return;
    }
    const exit: LspExit = { sessionId: id, code, signal: signal ?? null };
    this.send(LspChannel.ServerExit, exit);
    this.tearDown(id);
  }

  /**
   * Tears a session down: disposes its connection and kills its process. Safe to call repeatedly.
   * @param id The session identifier.
   */
  private tearDown(id: string): void {
    const session: LspSession | undefined = this.sessions.get(id);
    if (session === undefined) {
      return;
    }
    this.sessions.delete(id);
    try {
      session.connection.dispose();
    } catch {
      // Ignore disposal failures; the process is killed regardless.
    }
    pidJournal()?.unregister(session.child.pid);
    if (session.child.pid !== undefined) {
      killProcessTree(session.child.pid);
    }
  }

  /**
   * Registers handlers for the server-to-client requests a server issues during startup. Answering
   * these (rather than leaving them pending) is required or heavy servers stall mid-initialization.
   * @param connection The server connection to answer requests on.
   * @param sessionId The session the connection belongs to, for requests forwarded to the renderer.
   */
  private answerServerRequests(connection: MessageConnection, sessionId: string): void {
    connection.onRequest('client/registerCapability', (): null => null);
    connection.onRequest('client/unregisterCapability', (): null => null);
    connection.onRequest('window/workDoneProgress/create', (): null => null);
    // A server sends this when its semantic classification has improved (a project finished loading)
    // and cached tokens are stale. Forwarded to the renderer, which re-pulls and repaints.
    connection.onRequest('workspace/semanticTokens/refresh', (): null => {
      this.forwardNotification(sessionId, 'workspace/semanticTokens/refresh', undefined);
      return null;
    });
    // Answer each requested configuration item with null (rather than an empty object): null tells a
    // server to use its default for that setting, whereas `{}` is parsed as a value and rejected by
    // servers (such as Roslyn) that expect a scalar per key.
    connection.onRequest(
      'workspace/configuration',
      (params: { items?: readonly unknown[] }): unknown[] =>
        (params.items ?? []).map((): unknown => null),
    );
    // Any other server-to-client request is acknowledged with null so the server is never left
    // waiting on a response it requires to make progress.
    connection.onRequest((): null => null);
  }

  /**
   * Forwards a server notification to the renderer.
   * @param sessionId The session the notification belongs to.
   * @param method The LSP method name.
   * @param params The method parameters.
   */
  private forwardNotification(sessionId: string, method: string, params: unknown): void {
    // Only the notifications the renderer actually consumes cross the IPC boundary. A loading server
    // (Roslyn on a big solution) emits a large volume of progress and telemetry notifications; each
    // forwarded one is a structured-clone plus a renderer handler invocation, only to be discarded.
    if (!FORWARDED_NOTIFICATIONS.has(method)) {
      return;
    }
    const message: LspMessage = { sessionId, method, params };
    this.send(LspChannel.Notification, message);
  }

  /**
   * Validates and narrows an untrusted start request from the renderer.
   * @param request The candidate request.
   * @returns Returns the parsed request, or null when it is malformed.
   */
  private parseStartRequest(request: unknown): LspStartRequest | null {
    if (typeof request !== 'object' || request === null) {
      return null;
    }
    const candidate: {
      sessionId?: unknown;
      serverId?: unknown;
      rootPath?: unknown;
      standaloneFile?: unknown;
    } = request;
    if (
      typeof candidate.sessionId !== 'string' ||
      candidate.sessionId.length === 0 ||
      typeof candidate.serverId !== 'string' ||
      candidate.serverId.length === 0 ||
      typeof candidate.rootPath !== 'string' ||
      candidate.rootPath.length === 0
    ) {
      return null;
    }
    if (candidate.standaloneFile !== undefined && typeof candidate.standaloneFile !== 'string') {
      return null;
    }
    return {
      sessionId: candidate.sessionId,
      serverId: candidate.serverId,
      rootPath: candidate.rootPath,
      standaloneFile: candidate.standaloneFile,
    };
  }

  /**
   * Determines whether a session may be rooted at the requested path. A path is allowed when it is an
   * open workspace root, or when the request names a real, existing standalone file whose directory is
   * exactly that path — so a server can be rooted at a single opened file's folder without a workspace
   * being open. The server reads the directory directly (it is a trusted child process); this does not
   * widen the renderer's own, workspace-confined file access.
   * @param request The parsed start request.
   * @returns Returns true when the root is allowed.
   */
  private isAllowedRoot(request: LspStartRequest): boolean {
    if (this.workspaceContext.isRoot(request.rootPath)) {
      return true;
    }
    if (request.standaloneFile === undefined) {
      return false;
    }
    const file: string = path.resolve(request.standaloneFile);
    try {
      if (!statSync(file).isFile()) {
        return false;
      }
    } catch {
      return false;
    }
    return path.dirname(file) === path.resolve(request.rootPath);
  }

  /**
   * Builds the client capabilities advertised to every server. They cover diagnostics, document
   * synchronisation, and the core language features the renderer client surfaces.
   * @returns Returns the client capabilities.
   */
  private clientCapabilities(): ClientCapabilities {
    return {
      textDocument: {
        synchronization: { dynamicRegistration: true, didSave: true },
        publishDiagnostics: { relatedInformation: true },
        // Advertise pull diagnostics so a pull-based server (notably the Roslyn C# server, which does
        // not push `publishDiagnostics`) advertises its `diagnosticProvider` back and answers
        // `textDocument/diagnostic`; without this the server treats the client as push-only and the
        // Error List never receives its errors.
        diagnostic: { dynamicRegistration: false, relatedDocumentSupport: false },
        completion: { completionItem: { snippetSupport: true } },
        hover: { contentFormat: ['markdown', 'plaintext'] },
        definition: { linkSupport: false },
        references: {},
        // Advertise semantic tokens so servers send them; the renderer maps each server's legend onto
        // the standard one and feeds Monaco, colouring types, members, and parameters.
        semanticTokens: {
          requests: { full: true, range: false },
          tokenTypes: [...SEMANTIC_TOKEN_TYPES],
          tokenModifiers: [...SEMANTIC_TOKEN_MODIFIERS],
          formats: ['relative'],
          overlappingTokenSupport: false,
          multilineTokenSupport: false,
        },
      },
      // `refreshSupport` tells a server it may send `workspace/semanticTokens/refresh` when its
      // classification improves (a project finishes loading); without it heavy servers never signal
      // that their initial, degraded tokens should be re-requested.
      workspace: {
        workspaceFolders: true,
        configuration: true,
        semanticTokens: { refreshSupport: true },
      },
      window: { workDoneProgress: true },
    };
  }

  /**
   * Rejects a promise if it does not settle within the given time.
   * @param promise The promise to bound.
   * @param timeoutMs The timeout in milliseconds.
   * @returns Returns a promise that resolves with the original value or rejects on timeout.
   */
  private withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve: (value: T) => void, reject: (reason: Error) => void): void => {
      const timer: NodeJS.Timeout = setTimeout((): void => {
        reject(new Error('Timed out'));
      }, timeoutMs);
      promise.then(
        (value: T): void => {
          clearTimeout(timer);
          resolve(value);
        },
        (reason: unknown): void => {
          clearTimeout(timer);
          reject(reason instanceof Error ? reason : new Error('Request failed'));
        },
      );
    });
  }

  /**
   * Sends a message to the renderer window, if one is available and not destroyed.
   * @param channel The IPC channel to send on.
   * @param payload The payload to send.
   */
  private send(channel: LspChannel, payload: unknown): void {
    const window: BrowserWindow | null = this.windowGetter();
    if (window !== null && !window.isDestroyed()) {
      window.webContents.send(channel, payload);
    }
  }
}
