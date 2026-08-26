import { LanguageSlotEntry } from './language-slot';

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
   * Resolves a run configuration into a concrete launch target for the current provider, building the
   * project first where debugging requires an artifact (invoke).
   */
  Resolve = 'debug:resolve',

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

  /**
   * Asks the renderer to run the debuggee in an interactive run terminal, relaying an adapter's
   * `runInTerminal` reverse request (main→renderer, send).
   */
  RunInTerminal = 'debug:run-in-terminal',

  /**
   * Carries the renderer's answer to a relayed `runInTerminal` request back to the adapter (invoke).
   */
  RespondRunInTerminal = 'debug:respond-run-in-terminal',

  /**
   * Gets the registered debug adapters and the languages each debugs (invoke).
   */
  GetCatalogue = 'debug:get-catalogue',
}

/**
 * Identifies a debug adapter known to the main-process registry (for example `netcoredbg`). The
 * renderer references adapters by this identifier only; it never supplies an executable command, so a
 * hostile renderer cannot spawn an arbitrary process. The identifier is the one a provider names in its
 * {@link import('./project-system').DebugCapability}.
 */
export type DebugAdapterId = string;

/**
 * Describes one registered debug adapter as plain data — the debug slot's implementation descriptor —
 * for the renderer to resolve which adapter debugs a language and to offer the user the choice when a
 * language has more than one.
 */
export interface DebugAdapterSummary extends LanguageSlotEntry {
  /**
   * Gets the stable identifier the renderer names this adapter by.
   */
  readonly id: DebugAdapterId;
}

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
 * A concrete launch target for a debug session, resolved from a run configuration by the provider (for
 * .NET, the built assembly). The renderer folds these into the DAP `launch` request body.
 */
export interface DebugLaunchTarget {
  /**
   * Gets the absolute path of the program to launch (for .NET, the built `.dll`).
   */
  readonly program: string;

  /**
   * Gets the working directory to launch in, or undefined to use the workspace root.
   */
  readonly cwd?: string;

  /**
   * Gets the command-line arguments passed to the program, or undefined for none.
   */
  readonly args?: readonly string[];

  /**
   * Gets environment variables overlaid on the debuggee's environment, or undefined for none.
   */
  readonly env?: Readonly<Record<string, string>>;

  /**
   * Gets extra keys folded into the DAP `launch` request body, for the launch settings only a specific
   * adapter understands — debugpy's `python`, naming the interpreter the debuggee runs under, which is
   * the project's rather than the one the adapter itself runs from. Kept generic so a provider can
   * supply what its adapter needs without this contract learning every adapter's vocabulary.
   */
  readonly launchExtras?: Readonly<Record<string, unknown>>;
}

/**
 * The outcome of resolving a run configuration into a launch target: the target when resolution
 * succeeded, otherwise a human-readable reason (a build failure, an unavailable toolchain), so the
 * renderer can report why a session did not start.
 */
export interface DebugResolveResult {
  /**
   * Gets the resolved launch target, or null when resolution failed.
   */
  readonly target: DebugLaunchTarget | null;

  /**
   * Gets a human-readable reason resolution failed, or null on success.
   */
  readonly error: string | null;
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

/**
 * A relayed `runInTerminal` reverse request: the adapter wants the client to spawn the debuggee (in
 * an integrated terminal) and report its process id, so the adapter can attach to it.
 */
export interface DebugRunInTerminalRequest {
  /**
   * Gets the debug session the request belongs to.
   */
  readonly sessionId: string;

  /**
   * Gets the adapter's request sequence number, echoed back by the response.
   */
  readonly seq: number;

  /**
   * Gets the requested terminal kind. Only `integrated` is supported; `external` is declined.
   */
  readonly kind: 'integrated' | 'external';

  /**
   * Gets the adapter's suggested title, when it offered one.
   */
  readonly title?: string;

  /**
   * Gets the working directory the debuggee starts in.
   */
  readonly cwd: string;

  /**
   * Gets the command line as an argument vector (the executable first).
   */
  readonly args: readonly string[];

  /**
   * Gets environment variables to layer over the terminal's; a null value asks for the variable to be
   * unset (unsupported here and skipped).
   */
  readonly env?: Readonly<Record<string, string | null>>;
}

/**
 * The renderer's answer to a relayed `runInTerminal` request.
 */
export interface DebugRunInTerminalResponse {
  /**
   * Gets the debug session the answered request belongs to.
   */
  readonly sessionId: string;

  /**
   * Gets the answered request's sequence number.
   */
  readonly seq: number;

  /**
   * Gets the spawned debuggee's process id, when the launch succeeded.
   */
  readonly processId?: number;

  /**
   * Gets why the request could not be honoured, when it failed.
   */
  readonly error?: string;
}
