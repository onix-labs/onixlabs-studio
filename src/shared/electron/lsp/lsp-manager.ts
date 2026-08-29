import { BrowserWindow, ipcMain, IpcMainEvent, IpcMainInvokeEvent, WebContents } from 'electron';
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
  LspServerSummary,
  LspStartRequest,
  LspStartResult,
  SEMANTIC_TOKEN_MODIFIERS,
  SEMANTIC_TOKEN_TYPES,
} from '@shared/api/lsp-channels';
import { pidJournal } from '../pid-journal';
import { detachedSpawnOptions, killProcessTree } from '../process-tree';
import { WorkspaceContext } from '../workspace-context';
import { LspResolution, LspServerRegistry, LspServerSpec } from './lsp-server-registry';
import { FileEvent, LspFileWatcher } from './lsp-file-watcher';
import { globToRegExp } from './lsp-watch-glob';

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
  // Work-done progress is what a loading server says about itself; it is forwarded so a long start
  // shows what is loading rather than an inert spinner. (Telemetry and log chatter stay dropped.)
  '$/progress',
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
   * Holds the request the session was started from, so a restart can respawn it exactly.
   */
  readonly request: LspStartRequest;

  /**
   * Holds the watcher that tells the server about files changing under its root.
   */
  readonly watcher: LspFileWatcher;

  /**
   * Holds how many renderer clients are using this session, per renderer. Several surfaces can open
   * the same root (two tabs on one folder, a docked and a standalone editor, a pop-out window): each
   * Start increments its sender's count, each Stop decrements it, and the server is only torn down
   * when every count reaches zero — one surface closing must not kill the server another is still
   * using. Keyed by the renderer so that (a) the server's notifications reach every window that
   * holds the session, not only the main one, and (b) a window destroyed without stopping its
   * sessions (a crash, a force-close) releases them rather than pinning the server forever.
   */
  readonly clients: Map<WebContents, number>;

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
      (event: IpcMainInvokeEvent, request: unknown): Promise<LspStartResult> =>
        this.start(request, event.sender),
    );
    ipcMain.handle(LspChannel.Stop, (event: IpcMainInvokeEvent, id: unknown): Promise<void> =>
      typeof id === 'string' ? this.stop(id, event.sender) : Promise.resolve(),
    );
    ipcMain.handle(
      LspChannel.Restart,
      (_event: IpcMainInvokeEvent, id: unknown): Promise<LspStartResult> =>
        typeof id === 'string'
          ? this.restart(id)
          : Promise.resolve({ success: false, error: 'Invalid restart request' }),
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
    ipcMain.handle(LspChannel.GetCatalogue, (): readonly LspServerSummary[] =>
      this.registry.catalogue(),
    );
    logger.info('LspManager', 'Registered language-server IPC handlers');
  }

  /**
   * Disposes every running session. Called on application shutdown.
   */
  public disposeAll(): void {
    logger.info('LspManager', `Disposing all LSP sessions (${this.sessions.size})`);
    for (const id of [...this.sessions.keys()]) {
      this.tearDown(id);
    }
  }

  /**
   * Starts a session: validates the request, resolves and spawns the server, and runs the
   * `initialize`/`initialized` handshake.
   * @param request The start request from the renderer.
   * @param sender The renderer that asked, which the session's notifications are then delivered to.
   * @returns Returns the start outcome, including server capabilities on success.
   */
  private async start(request: unknown, sender: WebContents): Promise<LspStartResult> {
    const parsed: LspStartRequest | null = this.parseStartRequest(request);
    if (parsed === null) {
      logger.warn('LspManager', 'Rejected an invalid LSP start request');
      return { success: false, error: 'Invalid start request' };
    }
    logger.trace(
      'LspManager',
      `Start requested for session ${parsed.sessionId} (${parsed.serverId})`,
    );
    const existing: LspSession | undefined = this.sessions.get(parsed.sessionId);
    if (existing !== undefined) {
      this.attach(existing, parsed.sessionId, sender);
      logger.debug(
        'LspManager',
        `Reusing LSP session ${parsed.sessionId} (refCount now ${this.refCount(existing)})`,
      );
      return existing.ready;
    }
    return this.launch(parsed, sender);
  }

  /**
   * Restarts a running session in place: the server is torn down whatever its reference count, a
   * fresh one is spawned under the same session id, and every renderer that held the old session is
   * told (through an exit flagged `restarted`) so it re-opens its documents against the new server.
   * Holders re-attach themselves as they re-open, so the new session starts with no references and
   * the counts come back exactly as each client re-syncs.
   *
   * A restart used to be the renderer's own Stop followed by Start. Stop only decrements a reference
   * count, so with the session shared by another surface the old process survived and the "restarted"
   * client silently reattached to it — the spinner and the cleared crash counters were theatre.
   * @param id The session identifier.
   * @returns Returns the new session's start outcome, or a failure when no such session is running.
   */
  private async restart(id: string): Promise<LspStartResult> {
    const session: LspSession | undefined = this.sessions.get(id);
    if (session === undefined) {
      return { success: false, error: 'No such session' };
    }
    logger.info('LspManager', `Restarting LSP session ${id} on request`);
    const holders: WebContents[] = [...session.clients.keys()];
    await this.shutDown(id, session);
    const ready: Promise<LspStartResult> = this.launch(session.request, null);
    const exit: LspExit = { sessionId: id, code: null, signal: null, restarted: true };
    for (const contents of holders) {
      if (!contents.isDestroyed()) {
        contents.send(LspChannel.ServerExit, exit);
      }
    }
    return ready;
  }

  /**
   * Spawns a server for a validated start request, runs its handshake, and records the session.
   * @param parsed The validated start request.
   * @param sender The renderer to attach as the session's first holder, or null to attach none (a
   * restart, whose holders re-attach as they re-open their documents).
   * @returns Returns the start outcome, including server capabilities on success.
   */
  private async launch(
    parsed: LspStartRequest,
    sender: WebContents | null,
  ): Promise<LspStartResult> {
    if (!this.isAllowedRoot(parsed)) {
      logger.warn('LspManager', `LSP start denied for non-open root ${parsed.rootPath}`);
      return { success: false, error: 'Workspace root is not open' };
    }
    const resolution: LspResolution = await this.registry.resolve(parsed.serverId, parsed.rootPath);
    const spec: LspServerSpec | null = resolution.spec;
    if (spec === null) {
      logger.warn(
        'LspManager',
        `Server ${parsed.serverId} unavailable: ${resolution.error ?? 'unknown server'}`,
      );
      return {
        success: false,
        error: resolution.error ?? `Unknown or unavailable server: ${parsed.serverId}`,
      };
    }
    logger.debug(
      'LspManager',
      `Resolved ${parsed.serverId} to spawn ${spec.command} ${spec.args.join(' ')}`,
    );

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
    connection.onNotification((method: string, params: unknown): void =>
      this.forwardNotification(parsed.sessionId, method, params),
    );
    child.on('exit', (code: number | null, signal: NodeJS.Signals | null): void =>
      this.handleExit(parsed.sessionId, child, code, signal),
    );
    connection.listen();

    // The server learns about files changing under its root — a dependency install, a branch
    // switch, a file another tool wrote — through `workspace/didChangeWatchedFiles`. Without it a
    // server's picture of the workspace is a snapshot from spawn time: a package that landed a
    // minute later stays "missing" until the server is restarted.
    const watcher: LspFileWatcher = new LspFileWatcher(
      parsed.rootPath,
      (events: readonly FileEvent[]): void => {
        if (this.sessions.get(parsed.sessionId)?.child === child) {
          void connection.sendNotification('workspace/didChangeWatchedFiles', { changes: events });
        }
      },
    );
    const session: LspSession = {
      connection,
      child,
      rootPath: parsed.rootPath,
      request: parsed,
      watcher,
      clients: new Map<WebContents, number>(),
      ready: Promise.resolve({ success: false, error: 'Initialize pending' }),
    };
    this.answerServerRequests(connection, parsed.sessionId, session);
    this.sessions.set(parsed.sessionId, session);
    if (sender !== null) {
      this.attach(session, parsed.sessionId, sender);
    }

    // The handshake outcome (capabilities included) is retained on the session, so a concurrent or
    // later Start for the same session shares the real result instead of a capability-less success.
    session.ready = this.initialize(connection, parsed.rootPath, spec)
      .then((result: InitializeResult): LspStartResult => ({
        success: true,
        serverInfo: result.serverInfo,
        capabilities: result.capabilities,
      }))
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
    logger.trace('LspManager', `Sending initialize handshake for root ${rootPath}`);
    const result: InitializeResult = await this.withTimeout<InitializeResult>(
      connection.sendRequest('initialize', params),
      INITIALIZE_TIMEOUT_MS,
    );
    logger.debug('LspManager', `Initialize complete: ${result.serverInfo?.name ?? 'server'}`);
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
    logger.trace('LspManager', `Forwarding LSP request ${method} to session ${id}`);
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
   * Attaches a renderer to a session (or counts one more reference from a renderer already attached),
   * and arranges for a renderer that is destroyed without stopping its sessions to release them.
   * @param session The session being attached to.
   * @param id The session identifier.
   * @param sender The renderer attaching.
   */
  private attach(session: LspSession, id: string, sender: WebContents): void {
    const count: number = session.clients.get(sender) ?? 0;
    session.clients.set(sender, count + 1);
    if (count === 0) {
      sender.once('destroyed', (): void => {
        const current: LspSession | undefined = this.sessions.get(id);
        if (current !== session || !current.clients.has(sender)) {
          return;
        }
        current.clients.delete(sender);
        logger.debug('LspManager', `A renderer holding session ${id} was destroyed`);
        if (this.refCount(current) === 0) {
          void this.shutDown(id, current);
        }
      });
    }
  }

  /**
   * Sums a session's references across every renderer attached to it.
   * @param session The session.
   * @returns Returns the total reference count.
   */
  private refCount(session: LspSession): number {
    let total: number = 0;
    for (const count of session.clients.values()) {
      total += count;
    }
    return total;
  }

  /**
   * Stops a session on behalf of one client: its renderer's reference count decrements, and only
   * when the last reference across every renderer is gone is the server asked to shut down and torn
   * down — other surfaces sharing the session keep their working server.
   * @param id The session identifier.
   * @param sender The renderer stopping.
   * @returns Returns a promise that resolves once the stop has been applied.
   */
  private async stop(id: string, sender: WebContents): Promise<void> {
    const session: LspSession | undefined = this.sessions.get(id);
    if (session === undefined) {
      return;
    }
    const count: number = session.clients.get(sender) ?? 0;
    if (count <= 1) {
      session.clients.delete(sender);
    } else {
      session.clients.set(sender, count - 1);
    }
    const remaining: number = this.refCount(session);
    if (remaining > 0) {
      logger.debug('LspManager', `Stop for session ${id} (refCount now ${remaining}); kept alive`);
      return;
    }
    await this.shutDown(id, session);
  }

  /**
   * Asks a session's server to shut down gracefully, then tears it down regardless.
   * @param id The session identifier.
   * @param session The session.
   * @returns Returns a promise that resolves once the session is gone.
   */
  private async shutDown(id: string, session: LspSession): Promise<void> {
    logger.debug('LspManager', `Last client stopped session ${id}; shutting server down`);
    try {
      await this.withTimeout(session.connection.sendRequest('shutdown'), SHUTDOWN_TIMEOUT_MS);
      void session.connection.sendNotification('exit');
    } catch (error: unknown) {
      // The server is being killed regardless; ignore a failed graceful shutdown.
      logger.debug('LspManager', `Graceful shutdown failed for session ${id}`, error);
    }
    this.tearDown(id);
  }

  /**
   * Handles a server process exiting: notifies the renderer and tears the session down. Only the
   * process the session currently owns counts: a torn-down server's exit lands asynchronously, and by
   * then a fresh server may be running under the same session id (a restart, or a stop followed by an
   * immediate start) — treating that late exit as the new session's would tear the new server down
   * and report a crash that never happened.
   * @param id The session identifier.
   * @param child The process that exited.
   * @param code The process exit code, or null when terminated by a signal.
   * @param signal The terminating signal, or null when exited normally.
   */
  private handleExit(
    id: string,
    child: ChildProcessWithoutNullStreams,
    code: number | null,
    signal: NodeJS.Signals | null,
  ): void {
    if (this.sessions.get(id)?.child !== child) {
      return;
    }
    logger.info(
      'LspManager',
      `LSP server for session ${id} exited (code=${code}, signal=${signal})`,
    );
    const exit: LspExit = { sessionId: id, code, signal: signal ?? null };
    this.send(id, LspChannel.ServerExit, exit);
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
    logger.info('LspManager', `Stopping LSP server for session ${id} (pid ${session.child.pid})`);
    this.sessions.delete(id);
    session.watcher.close();
    try {
      session.connection.dispose();
    } catch (error: unknown) {
      // Ignore disposal failures; the process is killed regardless.
      logger.error('LspManager', `Failed to dispose LSP connection for session ${id}`, error);
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
  private answerServerRequests(
    connection: MessageConnection,
    sessionId: string,
    session: LspSession,
  ): void {
    // Dynamic registrations are honoured for the one capability the main process implements — file
    // watching — and acknowledged for the rest, since the client advertises them and a server that
    // registers, say, `textDocument/didSave` is served by the renderer regardless. They used to be
    // acknowledged and discarded wholesale, so a server that asked to watch `**/Cargo.toml` believed
    // it was being told about changes that never came.
    connection.onRequest(
      'client/registerCapability',
      (params: { registrations?: readonly unknown[] }): null => {
        for (const registration of params.registrations ?? []) {
          this.applyRegistration(session, registration);
        }
        return null;
      },
    );
    connection.onRequest(
      'client/unregisterCapability',
      (params: { unregisterations?: readonly { method?: unknown }[] }): null => {
        if (
          (params.unregisterations ?? []).some(
            (entry: { method?: unknown }): boolean =>
              entry.method === 'workspace/didChangeWatchedFiles',
          )
        ) {
          session.watcher.setPatterns(null);
        }
        return null;
      },
    );
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
   * Applies one dynamic registration: a `workspace/didChangeWatchedFiles` registration narrows the
   * session's file watcher to the server's globs (a relative pattern is taken relative to the
   * session root; an absolute or `file:` base is honoured when it is the root, and otherwise treated
   * as "anything", since the watcher only covers the root). Other methods need nothing here.
   * @param session The session the registration belongs to.
   * @param registration The registration entry, untrusted.
   */
  private applyRegistration(session: LspSession, registration: unknown): void {
    const entry: {
      method?: unknown;
      registerOptions?: { watchers?: readonly { globPattern?: unknown }[] };
    } | null = (registration as typeof entry) ?? null;
    if (entry?.method !== 'workspace/didChangeWatchedFiles') {
      return;
    }
    const patterns: RegExp[] = [];
    let unbounded: boolean = false;
    for (const watcher of entry.registerOptions?.watchers ?? []) {
      const glob: unknown = watcher.globPattern;
      if (typeof glob === 'string') {
        if (path.isAbsolute(glob) || glob.startsWith('file:')) {
          // An absolute glob outside our root cannot be narrowed safely; report everything.
          unbounded = true;
        } else {
          patterns.push(globToRegExp(glob));
        }
      } else if (typeof glob === 'object' && glob !== null) {
        const relative: { baseUri?: unknown; pattern?: unknown } = glob;
        if (typeof relative.pattern === 'string') {
          patterns.push(globToRegExp(relative.pattern));
        }
      }
    }
    session.watcher.setPatterns(unbounded || patterns.length === 0 ? null : patterns);
    logger.debug(
      'LspManager',
      `Server registered ${patterns.length} watch pattern(s) for ${session.rootPath}`,
    );
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
    this.send(sessionId, LspChannel.Notification, message);
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
        // The main process watches the session root and sends `didChangeWatchedFiles`; a server
        // narrows that to its own globs through a dynamic registration.
        didChangeWatchedFiles: { dynamicRegistration: true, relativePatternSupport: true },
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
   * Sends a session's message to every renderer attached to it. Delivery used to go to the main
   * window alone, so a client in a pop-out window never received its diagnostics — or the exit
   * notification that would have told it its server had died. A session with no attached renderer
   * (its exit racing its last stop) falls back to the main window, whose clients ignore sessions they
   * do not own.
   * @param sessionId The session the message belongs to.
   * @param channel The IPC channel to send on.
   * @param payload The payload to send.
   */
  private send(sessionId: string, channel: LspChannel, payload: unknown): void {
    const session: LspSession | undefined = this.sessions.get(sessionId);
    const targets: WebContents[] = [...(session?.clients.keys() ?? [])].filter(
      (contents: WebContents): boolean => !contents.isDestroyed(),
    );
    if (targets.length === 0) {
      const window: BrowserWindow | null = this.windowGetter();
      if (window !== null && !window.isDestroyed()) {
        targets.push(window.webContents);
      }
    }
    for (const contents of targets) {
      contents.send(channel, payload);
    }
  }
}
