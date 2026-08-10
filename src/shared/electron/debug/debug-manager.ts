import { BrowserWindow, ipcMain, IpcMainInvokeEvent } from 'electron';
import type { DebugProtocol } from '@vscode/debugprotocol';
import { logger } from '../logger';
import {
  DebugAdapterExit,
  DebugChannel,
  DebugEventMessage,
  DebugRunInTerminalRequest,
  DebugRunInTerminalResponse,
  DebugStartRequest,
  DebugStartResult,
} from '@shared/api/debug-channels';
import { WorkspaceContext } from '../workspace-context';
import { DapClient, DebugAdapterConnection } from './dap-client';
import { StdioTransport } from './dap-transport';
import {
  DebugAdapterRegistry,
  DebugAdapterResolution,
  DebugAdapterSpec,
} from './debug-adapter-registry';
import { JsDebugSession } from './js-debug-session';

/**
 * Holds a running debug session: its adapter connection and the workspace root it is rooted at.
 */
interface DebugSession {
  /**
   * Holds the connection driving the session's adapter (a stdio client, or a compound js-debug session).
   */
  readonly client: DebugAdapterConnection;

  /**
   * Holds the absolute workspace root the session is rooted at.
   */
  readonly rootPath: string;
}

/**
 * Manages debug-adapter sessions for the renderer, the debug counterpart of the {@link
 * import('../lsp/lsp-manager').LspManager}. The main process owns each adapter's lifecycle: it resolves
 * the executable from a registry (never from the renderer), spawns it, runs the DAP `initialize`
 * handshake, forwards the adapter's events to the renderer, and forwards the renderer's DAP requests to
 * the adapter. The renderer drives the launch sequence and execution control, so this stays a thin
 * transport. One instance is owned by the main process.
 */
export class DebugManager {
  /**
   * Holds the function used to resolve the window that adapter events are sent to.
   */
  private readonly windowGetter: () => BrowserWindow | null;

  /**
   * Holds the open-workspace tracker used to confine sessions to opened roots.
   */
  private readonly workspaceContext: WorkspaceContext;

  /**
   * Holds the registry that resolves an adapter identifier into a spawn specification.
   */
  private readonly registry: DebugAdapterRegistry;

  /**
   * Holds the running sessions, keyed by session identifier.
   */
  private readonly sessions: Map<string, DebugSession> = new Map<string, DebugSession>();

  /**
   * Initializes a new instance of the {@link DebugManager} class.
   * @param windowGetter A function that returns the window adapter events are sent to.
   * @param workspaceContext The open-workspace tracker used to confine sessions to opened roots.
   * @param registry The registry that resolves adapter identifiers into spawn specifications.
   */
  public constructor(
    windowGetter: () => BrowserWindow | null,
    workspaceContext: WorkspaceContext,
    registry: DebugAdapterRegistry,
  ) {
    this.windowGetter = windowGetter;
    this.workspaceContext = workspaceContext;
    this.registry = registry;
  }

  /**
   * Registers the debug IPC handlers.
   */
  public register(): void {
    ipcMain.handle(
      DebugChannel.RespondRunInTerminal,
      (_event: IpcMainInvokeEvent, payload: unknown): boolean => this.respondRunInTerminal(payload),
    );
    ipcMain.handle(
      DebugChannel.Start,
      (_event: IpcMainInvokeEvent, request: unknown): Promise<DebugStartResult> =>
        this.start(request),
    );
    ipcMain.handle(
      DebugChannel.Stop,
      (_event: IpcMainInvokeEvent, id: unknown): Promise<void> =>
        typeof id === 'string' ? this.stop(id) : Promise.resolve(),
    );
    ipcMain.handle(
      DebugChannel.Request,
      (
        _event: IpcMainInvokeEvent,
        id: unknown,
        command: unknown,
        args: unknown,
      ): Promise<unknown> => this.request(id, command, args),
    );
    logger.info('DebugManager', 'Registered debug IPC handlers');
  }

  /**
   * Disposes every running session. Called on application shutdown. Each adapter is asked to
   * disconnect (terminating its debuggee) best-effort before its process tree is ended — shutdown
   * cannot wait for an answer, but the transport's tree kill reaches the debuggee regardless.
   */
  public disposeAll(): void {
    logger.info('DebugManager', `Disposing all debug sessions (${this.sessions.size})`);
    for (const [id, session] of [...this.sessions]) {
      void session.client
        .sendRequest('disconnect', { terminateDebuggee: true })
        .catch((): void => undefined);
      this.tearDown(id);
    }
  }

  /**
   * Starts a session: validates the request, resolves and spawns the adapter, and runs the `initialize`
   * handshake. The renderer sends `launch`/`attach` and configuration next, over {@link request}.
   * @param request The start request from the renderer.
   * @returns Returns the start outcome, including adapter capabilities on success.
   */
  private async start(request: unknown): Promise<DebugStartResult> {
    const parsed: DebugStartRequest | null = this.parseStartRequest(request);
    if (parsed === null) {
      logger.warn('DebugManager', 'Rejected an invalid debug start request');
      return { success: false, error: 'Invalid start request' };
    }
    logger.trace(
      'DebugManager',
      `Start requested for session ${parsed.sessionId} (${parsed.adapterId})`,
    );
    if (this.sessions.has(parsed.sessionId)) {
      logger.debug('DebugManager', `Reusing existing debug session ${parsed.sessionId}`);
      return { success: true };
    }
    if (!this.workspaceContext.isRoot(parsed.rootPath)) {
      logger.warn('DebugManager', `Debug start denied for non-open root ${parsed.rootPath}`);
      return { success: false, error: 'Workspace root is not open' };
    }
    const resolution: DebugAdapterResolution = await this.registry.resolve(
      parsed.adapterId,
      parsed.rootPath,
    );
    if (resolution.spec === null) {
      logger.warn(
        'DebugManager',
        `Adapter ${parsed.adapterId} unavailable: ${resolution.error ?? 'unknown adapter'}`,
      );
      return {
        success: false,
        error: resolution.error ?? `Unknown or unavailable adapter: ${parsed.adapterId}`,
      };
    }

    const client: DebugAdapterConnection = this.connect(resolution.spec, parsed.rootPath);
    client.onEvent((event: DebugProtocol.Event): void =>
      this.forwardEvent(parsed.sessionId, event),
    );
    client.onExit((code: number | null, signal: string | null): void =>
      this.handleExit(parsed.sessionId, code, signal),
    );
    client.onRunInTerminal(
      (
        request: DebugProtocol.Request,
        respond: (body?: unknown, success?: boolean) => void,
      ): void => this.relayRunInTerminal(parsed.sessionId, request, respond),
    );
    // Register the session before initializing so an event or exit racing the handshake is handled.
    this.sessions.set(parsed.sessionId, { client, rootPath: parsed.rootPath });

    try {
      await client.start();
      const capabilities: DebugProtocol.Capabilities = await client.initialize(parsed.adapterId);
      logger.info('DebugManager', `Debug session started (${parsed.adapterId})`);
      return { success: true, capabilities };
    } catch (error: unknown) {
      logger.error('DebugManager', `Debug session failed to start (${parsed.adapterId})`, error);
      this.tearDown(parsed.sessionId);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Initialize failed',
      };
    }
  }

  /**
   * Builds the connection for a resolved adapter: a compound js-debug session for a `tcp-server` adapter,
   * or a plain stdio client otherwise.
   * @param spec The resolved adapter specification.
   * @param rootPath The workspace root the session is rooted at (the adapter's working directory).
   * @returns Returns the connection.
   */
  private connect(spec: DebugAdapterSpec, rootPath: string): DebugAdapterConnection {
    if (spec.transport === 'tcp-server') {
      logger.debug('DebugManager', `Using compound js-debug session for ${spec.command}`);
      return new JsDebugSession(spec, rootPath);
    }
    logger.debug('DebugManager', `Using stdio adapter connection for ${spec.command}`);
    return new DapClient(new StdioTransport(spec.command, spec.args, spec.env, rootPath));
  }

  /**
   * Sends a DAP request to a session's adapter and awaits its response.
   * @param id The session identifier.
   * @param command The DAP request command.
   * @param args The request arguments.
   * @returns Returns the adapter's response body, or rejects when the session or arguments are invalid
   * or the adapter reports an error.
   */
  private request(id: unknown, command: unknown, args: unknown): Promise<unknown> {
    if (typeof id !== 'string' || typeof command !== 'string' || command.length === 0) {
      return Promise.reject(new Error('Invalid request'));
    }
    const session: DebugSession | undefined = this.sessions.get(id);
    if (session === undefined) {
      return Promise.reject(new Error('No such session'));
    }
    logger.trace('DebugManager', `Forwarding DAP request ${command} to session ${id}`);
    return session.client.sendRequest(command, args);
  }

  /**
   * Stops a session: asks the adapter to disconnect (terminating the debuggee), then tears the session
   * down regardless of the outcome.
   * @param id The session identifier.
   * @returns Returns a promise that resolves once the session has been torn down.
   */
  private async stop(id: string): Promise<void> {
    const session: DebugSession | undefined = this.sessions.get(id);
    if (session === undefined) {
      return;
    }
    logger.trace('DebugManager', `Stopping debug session ${id}`);
    try {
      await session.client.sendRequest('disconnect', { terminateDebuggee: true });
    } catch (error: unknown) {
      // The adapter is being killed regardless; ignore a failed graceful disconnect.
      logger.debug('DebugManager', `Graceful disconnect failed for session ${id}`, error);
    }
    this.tearDown(id);
  }

  /**
   * Handles an adapter process exiting: notifies the renderer and tears the session down.
   * @param id The session identifier.
   * @param code The process exit code, or null when terminated by a signal.
   * @param signal The terminating signal, or null when exited normally.
   */
  private handleExit(id: string, code: number | null, signal: string | null): void {
    if (!this.sessions.has(id)) {
      return;
    }
    logger.info(
      'DebugManager',
      `Debug session ${id} adapter exited (code=${code}, signal=${signal})`,
    );
    const exit: DebugAdapterExit = { sessionId: id, code, signal };
    this.send(DebugChannel.AdapterExit, exit);
    this.tearDown(id);
  }

  /**
   * Tears a session down: disposes its client (killing the adapter). Safe to call repeatedly.
   * @param id The session identifier.
   */
  private tearDown(id: string): void {
    const session: DebugSession | undefined = this.sessions.get(id);
    if (session === undefined) {
      return;
    }
    logger.debug('DebugManager', `Tearing down debug session ${id}`);
    this.sessions.delete(id);
    this.failPendingTerminalRequests(id);
    try {
      session.client.dispose();
    } catch (error: unknown) {
      // Best-effort cleanup; the process is killed regardless.
      logger.error('DebugManager', `Failed to dispose debug session ${id}`, error);
    }
  }

  /**
   * Holds the responders of relayed `runInTerminal` requests awaiting the renderer's answer, keyed
   * `sessionId:seq`.
   */
  private readonly terminalResponders: Map<string, (body?: unknown, success?: boolean) => void> =
    new Map<string, (body?: unknown, success?: boolean) => void>();

  /**
   * Relays an adapter's `runInTerminal` reverse request to the renderer, which hosts the debuggee in
   * the workspace's interactive run terminal and answers with its process id.
   * @param sessionId The debug session the request belongs to.
   * @param request The reverse request.
   * @param respond The responder bound to the requesting connection.
   */
  private relayRunInTerminal(
    sessionId: string,
    request: DebugProtocol.Request,
    respond: (body?: unknown, success?: boolean) => void,
  ): void {
    const args: {
      kind?: unknown;
      title?: unknown;
      cwd?: unknown;
      args?: unknown;
      env?: unknown;
    } = (request.arguments as object | undefined) ?? {};
    const argv: readonly string[] = Array.isArray(args.args)
      ? args.args.filter((entry: unknown): entry is string => typeof entry === 'string')
      : [];
    if (argv.length === 0) {
      logger.warn('DebugManager', `runInTerminal request with no command for session ${sessionId}`);
      respond(undefined, false);
      return;
    }
    logger.trace(
      'DebugManager',
      `Relaying runInTerminal request to renderer for session ${sessionId}`,
    );
    this.terminalResponders.set(`${sessionId}:${request.seq}`, respond);
    const message: DebugRunInTerminalRequest = {
      sessionId,
      seq: request.seq,
      kind: args.kind === 'external' ? 'external' : 'integrated',
      title: typeof args.title === 'string' ? args.title : undefined,
      cwd: typeof args.cwd === 'string' ? args.cwd : '',
      args: argv,
      env: (args.env as Readonly<Record<string, string | null>> | undefined) ?? undefined,
    };
    this.send(DebugChannel.RunInTerminal, message);
  }

  /**
   * Completes a relayed `runInTerminal` request with the renderer's answer.
   * @param payload The candidate response from the renderer.
   * @returns Returns true when a pending request was completed.
   */
  private respondRunInTerminal(payload: unknown): boolean {
    const response: Partial<DebugRunInTerminalResponse> =
      (payload as Partial<DebugRunInTerminalResponse> | undefined) ?? {};
    if (typeof response.sessionId !== 'string' || typeof response.seq !== 'number') {
      return false;
    }
    const key: string = `${response.sessionId}:${response.seq}`;
    const respond: ((body?: unknown, success?: boolean) => void) | undefined =
      this.terminalResponders.get(key);
    if (respond === undefined) {
      return false;
    }
    this.terminalResponders.delete(key);
    if (typeof response.error === 'string') {
      respond(undefined, false);
    } else {
      respond({ processId: response.processId }, true);
    }
    return true;
  }

  /**
   * Fails any relayed `runInTerminal` requests still awaiting an answer when their session ends.
   * @param sessionId The ended session.
   */
  private failPendingTerminalRequests(sessionId: string): void {
    for (const [key, respond] of [...this.terminalResponders]) {
      if (key.startsWith(`${sessionId}:`)) {
        this.terminalResponders.delete(key);
        respond(undefined, false);
      }
    }
  }

  /**
   * Forwards an adapter event to the renderer.
   * @param sessionId The session the event belongs to.
   * @param event The DAP event.
   */
  private forwardEvent(sessionId: string, event: DebugProtocol.Event): void {
    const message: DebugEventMessage = { sessionId, event: event.event, body: event.body };
    this.send(DebugChannel.Event, message);
  }

  /**
   * Validates and narrows an untrusted start request from the renderer.
   * @param request The candidate request.
   * @returns Returns the parsed request, or null when it is malformed.
   */
  private parseStartRequest(request: unknown): DebugStartRequest | null {
    if (typeof request !== 'object' || request === null) {
      return null;
    }
    const candidate: { sessionId?: unknown; adapterId?: unknown; rootPath?: unknown } = request;
    if (
      typeof candidate.sessionId !== 'string' ||
      candidate.sessionId.length === 0 ||
      typeof candidate.adapterId !== 'string' ||
      candidate.adapterId.length === 0 ||
      typeof candidate.rootPath !== 'string' ||
      candidate.rootPath.length === 0
    ) {
      return null;
    }
    return {
      sessionId: candidate.sessionId,
      adapterId: candidate.adapterId,
      rootPath: candidate.rootPath,
    };
  }

  /**
   * Sends a message to the renderer window, if one is available and not destroyed.
   * @param channel The IPC channel to send on.
   * @param payload The payload to send.
   */
  private send(channel: DebugChannel, payload: unknown): void {
    const window: BrowserWindow | null = this.windowGetter();
    if (window !== null && !window.isDestroyed()) {
      window.webContents.send(channel, payload);
    }
  }
}
