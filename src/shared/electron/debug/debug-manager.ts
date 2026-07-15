import { BrowserWindow, ipcMain, IpcMainInvokeEvent } from 'electron';
import type { DebugProtocol } from '@vscode/debugprotocol';
import {
  DebugAdapterExit,
  DebugChannel,
  DebugEventMessage,
  DebugStartRequest,
  DebugStartResult,
} from '@shared/api/debug-channels';
import { WorkspaceContext } from '../workspace-context';
import { DapClient } from './dap-client';
import { DebugAdapterRegistry, DebugAdapterResolution } from './debug-adapter-registry';

/**
 * Holds a running debug session: its adapter client and the workspace root it is rooted at.
 */
interface DebugSession {
  /**
   * Holds the DAP client driving the session's adapter.
   */
  readonly client: DapClient;

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
   * Starts a session: validates the request, resolves and spawns the adapter, and runs the `initialize`
   * handshake. The renderer sends `launch`/`attach` and configuration next, over {@link request}.
   * @param request The start request from the renderer.
   * @returns Returns the start outcome, including adapter capabilities on success.
   */
  private async start(request: unknown): Promise<DebugStartResult> {
    const parsed: DebugStartRequest | null = this.parseStartRequest(request);
    if (parsed === null) {
      return { success: false, error: 'Invalid start request' };
    }
    if (this.sessions.has(parsed.sessionId)) {
      return { success: true };
    }
    if (!this.workspaceContext.isRoot(parsed.rootPath)) {
      return { success: false, error: 'Workspace root is not open' };
    }
    const resolution: DebugAdapterResolution = await this.registry.resolve(
      parsed.adapterId,
      parsed.rootPath,
    );
    if (resolution.spec === null) {
      return {
        success: false,
        error: resolution.error ?? `Unknown or unavailable adapter: ${parsed.adapterId}`,
      };
    }

    const client: DapClient = new DapClient(resolution.spec, parsed.rootPath);
    client.onEvent((event: DebugProtocol.Event): void =>
      this.forwardEvent(parsed.sessionId, event),
    );
    client.onExit((code: number | null, signal: string | null): void =>
      this.handleExit(parsed.sessionId, code, signal),
    );
    // Register the session before initializing so an event or exit racing the handshake is handled.
    this.sessions.set(parsed.sessionId, { client, rootPath: parsed.rootPath });

    try {
      await client.start();
      const capabilities: DebugProtocol.Capabilities = await client.initialize(parsed.adapterId);
      return { success: true, capabilities };
    } catch (error: unknown) {
      this.tearDown(parsed.sessionId);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Initialize failed',
      };
    }
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
    try {
      await session.client.sendRequest('disconnect', { terminateDebuggee: true });
    } catch {
      // The adapter is being killed regardless; ignore a failed graceful disconnect.
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
    this.sessions.delete(id);
    try {
      session.client.dispose();
    } catch {
      // Best-effort cleanup; the process is killed regardless.
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
