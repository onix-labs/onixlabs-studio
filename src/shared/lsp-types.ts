// Shared Language Server Protocol types used between the Electron main process and the renderer.
// Keep this module platform-neutral (no Node or DOM dependencies) so both compilation targets can
// import it.

/**
 * Identifies a language server known to the main-process registry (for example `typescript`). The
 * renderer references servers by this identifier only; it never supplies an executable command, so a
 * hostile renderer cannot spawn an arbitrary process.
 */
export type LspServerId = string;

/**
 * Describes a request to start a language-server session.
 */
export interface LspStartRequest {
  /**
   * Gets the renderer-minted session identifier the started server is keyed by. The renderer chooses
   * one session per (workspace root, language server).
   */
  readonly sessionId: string;

  /**
   * Gets the identifier of the registered server to start.
   */
  readonly serverId: LspServerId;

  /**
   * Gets the absolute workspace root the server is rooted at. It must be an open workspace root; the
   * main process rejects any other path.
   */
  readonly rootPath: string;
}

/**
 * Describes the server software backing a session, as reported by the server's `initialize` result.
 */
export interface LspServerInfo {
  /**
   * Gets the server's self-reported name.
   */
  readonly name: string;

  /**
   * Gets the server's self-reported version, when provided.
   */
  readonly version?: string;
}

/**
 * Reports the outcome of starting a language-server session.
 */
export interface LspStartResult {
  /**
   * Gets a value indicating whether the server started and completed its `initialize` handshake.
   */
  readonly success: boolean;

  /**
   * Gets the server software information, when the server started successfully.
   */
  readonly serverInfo?: LspServerInfo;

  /**
   * Gets the server's advertised capabilities (an LSP `ServerCapabilities` object), opaque at this
   * layer and interpreted by the renderer client.
   */
  readonly capabilities?: unknown;

  /**
   * Gets the failure reason, when the server did not start.
   */
  readonly error?: string;
}

/**
 * Carries a single JSON-RPC message (an LSP notification) between the renderer and a session's
 * server, in either direction.
 */
export interface LspMessage {
  /**
   * Gets the identifier of the session the message belongs to.
   */
  readonly sessionId: string;

  /**
   * Gets the LSP method name (for example `textDocument/publishDiagnostics`).
   */
  readonly method: string;

  /**
   * Gets the method parameters, whose shape is defined by the LSP method.
   */
  readonly params?: unknown;
}

/**
 * Reports that a session's server process exited (cleanly or by crashing).
 */
export interface LspExit {
  /**
   * Gets the identifier of the session whose server exited.
   */
  readonly sessionId: string;

  /**
   * Gets the process exit code, or null when the process was terminated by a signal.
   */
  readonly code: number | null;

  /**
   * Gets the terminating signal, or null when the process exited normally.
   */
  readonly signal: string | null;
}

/**
 * Specifies the language-server operations exposed to the renderer. The main process owns each
 * server's lifecycle (spawn, `initialize`, `shutdown`, crash handling); the renderer drives document
 * synchronisation and language features by forwarding LSP notifications and requests through this
 * surface.
 */
export interface LspApi {
  /**
   * Starts a language-server session, performing the `initialize`/`initialized` handshake.
   * @param request The session, server, and workspace root to start.
   * @returns Returns the start outcome, including server capabilities on success.
   */
  start(request: LspStartRequest): Promise<LspStartResult>;

  /**
   * Stops a language-server session, shutting the server down and terminating its process.
   * @param sessionId The session to stop.
   * @returns Returns a promise that resolves once the stop request has been sent.
   */
  stop(sessionId: string): Promise<void>;

  /**
   * Sends an LSP notification to a session's server (for example `textDocument/didOpen`).
   * @param sessionId The session whose server receives the notification.
   * @param method The LSP method name.
   * @param params The method parameters.
   */
  notify(sessionId: string, method: string, params?: unknown): void;

  /**
   * Sends an LSP request to a session's server and awaits its response (for example
   * `textDocument/completion`).
   * @param sessionId The session whose server receives the request.
   * @param method The LSP method name.
   * @param params The method parameters.
   * @returns Returns the server's result, or rejects when the server reports an error.
   */
  request(sessionId: string, method: string, params?: unknown): Promise<unknown>;

  /**
   * Subscribes to LSP notifications pushed from any session's server (for example
   * `textDocument/publishDiagnostics`).
   * @param listener Receives each server notification.
   * @returns Returns a function that unsubscribes the listener.
   */
  onNotification(listener: (message: LspMessage) => void): () => void;

  /**
   * Subscribes to server-process exits across all sessions.
   * @param listener Receives each exit report.
   * @returns Returns a function that unsubscribes the listener.
   */
  onExit(listener: (exit: LspExit) => void): () => void;
}
