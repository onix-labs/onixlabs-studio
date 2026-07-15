// Shared Debug Adapter Protocol contract used between the Electron main process and the renderer.
// Keep this module platform-neutral (no Node or DOM dependencies) so both compilation targets can
// import it. The renderer's debug client and the main-process debug manager name their channels from
// here, over the generic `Bridge` transport (`window.bridge`); the main process owns each adapter's
// lifecycle, so a hostile renderer can only reference adapters by id, never spawn arbitrary processes.
//
// This mirrors `lsp-channels.ts`: a session is started by id + workspace root, driven by forwarding DAP
// requests, and reports the adapter's events and exit back to the renderer. The DAP message bodies
// themselves are opaque at this layer (typed by `@vscode/debugprotocol` where they are interpreted).

/**
 * Names the Debug Adapter Protocol IPC channels.
 */
export enum DebugChannel {
  /**
   * Starts a debug session: spawns the adapter and completes the `initialize` handshake (invoke).
   */
  Start = 'debug:start',

  /**
   * Stops a debug session, disconnecting and terminating the adapter (invoke).
   */
  Stop = 'debug:stop',

  /**
   * Sends a DAP request to a session's adapter and awaits its response (invoke).
   */
  Request = 'debug:request',

  /**
   * Pushes a DAP event from a session's adapter to the renderer (main→renderer, send).
   */
  Event = 'debug:event',

  /**
   * Notifies the renderer that an adapter process exited (main→renderer, send).
   */
  AdapterExit = 'debug:adapter-exit',
}

/**
 * Identifies a debug adapter known to the main-process registry (for example `netcoredbg`). The
 * renderer references adapters by this identifier only; it never supplies an executable command, so a
 * hostile renderer cannot spawn an arbitrary process. The identifier is the one a provider names in its
 * {@link import('./project-system').DebugCapability}.
 */
export type DebugAdapterId = string;

/**
 * Describes a request to start a debug session.
 */
export interface DebugStartRequest {
  /**
   * Gets the renderer-minted session identifier the started adapter is keyed by. The renderer chooses
   * one session per launched run configuration.
   */
  readonly sessionId: string;

  /**
   * Gets the identifier of the registered adapter to start.
   */
  readonly adapterId: DebugAdapterId;

  /**
   * Gets the absolute workspace root the session is rooted at. It must be an open workspace root; the
   * main process rejects any other path.
   */
  readonly rootPath: string;
}

/**
 * Describes the adapter software backing a session, as reported by the adapter during startup.
 */
export interface DebugAdapterInfo {
  /**
   * Gets the adapter's self-reported name, when provided.
   */
  readonly name?: string;

  /**
   * Gets the adapter's self-reported version, when provided.
   */
  readonly version?: string;
}

/**
 * Reports the outcome of starting a debug session.
 */
export interface DebugStartResult {
  /**
   * Gets a value indicating whether the adapter started and completed its `initialize` handshake.
   */
  readonly success: boolean;

  /**
   * Gets the adapter's advertised capabilities (a DAP `Capabilities` object), opaque at this layer and
   * interpreted by the renderer client, when the adapter started successfully.
   */
  readonly capabilities?: unknown;

  /**
   * Gets the adapter software information, when the adapter started successfully.
   */
  readonly adapterInfo?: DebugAdapterInfo;

  /**
   * Gets the failure reason, when the adapter did not start.
   */
  readonly error?: string;
}

/**
 * Carries a single DAP event from a session's adapter to the renderer.
 */
export interface DebugEventMessage {
  /**
   * Gets the identifier of the session the event belongs to.
   */
  readonly sessionId: string;

  /**
   * Gets the DAP event name (for example `stopped`, `output`, or `terminated`).
   */
  readonly event: string;

  /**
   * Gets the event body, whose shape is defined by the DAP event.
   */
  readonly body?: unknown;
}

/**
 * Reports that a session's adapter process exited (cleanly or by crashing).
 */
export interface DebugAdapterExit {
  /**
   * Gets the identifier of the session whose adapter exited.
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
