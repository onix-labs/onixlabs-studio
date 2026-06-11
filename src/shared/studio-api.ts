// Shared contract between the Electron (back-end) and Angular (front-end) processes.
// The preload script implements this API and exposes it on `window.studio`; the
// renderer consumes it. Keep this module platform-neutral (types only — no Node or
// DOM dependencies) so both compilation targets can import it.

/**
 * Defines the runtime version information exposed to the renderer process.
 */
export interface RuntimeVersions {
  /**
   * Gets the Node.js version the application is running on.
   * @returns Returns the Node.js version string.
   */
  node(): string;

  /**
   * Gets the Chromium version the application is running on.
   * @returns Returns the Chromium version string.
   */
  chrome(): string;

  /**
   * Gets the Electron version the application is running on.
   * @returns Returns the Electron version string.
   */
  electron(): string;
}

/**
 * Defines the window control operations exposed to the renderer process.
 */
export interface WindowControlsApi {
  /**
   * Minimizes the application window.
   */
  minimize(): void;

  /**
   * Toggles the application window between its maximized and restored states.
   */
  toggleMaximize(): void;

  /**
   * Closes the application window.
   */
  close(): void;
}

/**
 * Defines the options sent from the renderer when spawning a pseudo-terminal session.
 */
export interface TerminalCreateOptions {
  /**
   * Gets the unique identifier of the terminal session (the owning tab's id).
   */
  readonly id: string;

  /**
   * Gets the initial column count, if known.
   */
  readonly cols?: number;

  /**
   * Gets the initial row count, if known.
   */
  readonly rows?: number;

  /**
   * Gets the working directory to start in. Falls back to the user's home directory.
   */
  readonly cwd?: string;
}

/**
 * Defines the result of a terminal create request.
 */
export interface TerminalCreateResult {
  /**
   * Gets a value indicating whether the session spawned successfully.
   */
  readonly success: boolean;

  /**
   * Gets the process identifier of the spawned shell, when successful.
   */
  readonly pid?: number;

  /**
   * Gets the error message, when the spawn failed.
   */
  readonly error?: string;

  /**
   * Gets the shell executable that was launched, when successful.
   */
  readonly shell?: string;
}

/**
 * Defines the pseudo-terminal operations exposed to the renderer process. Output and exit are
 * delivered through listener subscriptions, each returning a function that removes the listener.
 */
export interface TerminalApi {
  /**
   * Spawns a new pseudo-terminal session.
   * @param options The terminal creation options.
   * @returns Returns the result describing success and the spawned shell.
   */
  create(options: TerminalCreateOptions): Promise<TerminalCreateResult>;

  /**
   * Writes input data to a session.
   * @param id The terminal identifier.
   * @param data The data to write.
   * @returns Returns true when the session exists and the data was written.
   */
  write(id: string, data: string): Promise<boolean>;

  /**
   * Resizes a session.
   * @param id The terminal identifier.
   * @param cols The new column count.
   * @param rows The new row count.
   * @returns Returns true when the session exists and was resized.
   */
  resize(id: string, cols: number, rows: number): Promise<boolean>;

  /**
   * Disposes (kills) a session.
   * @param id The terminal identifier.
   * @returns Returns true when the session existed and was disposed.
   */
  dispose(id: string): Promise<boolean>;

  /**
   * Gets the current working directory of a session.
   * @param id The terminal identifier.
   * @returns Returns the working directory, or null when it cannot be determined.
   */
  getCwd(id: string): Promise<string | null>;

  /**
   * Subscribes to output data from sessions.
   * @param listener Receives the terminal id and the output data chunk.
   * @returns Returns a function that removes the listener.
   */
  onData(listener: (id: string, data: string) => void): () => void;

  /**
   * Subscribes to session exit notifications.
   * @param listener Receives the terminal id, exit code, and signal (or null).
   * @returns Returns a function that removes the listener.
   */
  onExit(listener: (id: string, exitCode: number, signal: number | null) => void): () => void;
}

/**
 * Defines the minimal, sandboxed API surface exposed to the renderer process via
 * the context bridge. This is the only channel through which the renderer reaches
 * privileged capability.
 */
export interface StudioApi {
  /**
   * Gets the runtime version information for the host process.
   */
  readonly versions: RuntimeVersions;

  /**
   * Gets the operating system platform the application is running on (the Node.js
   * `process.platform` value, such as `darwin`, `win32`, or `linux`).
   */
  readonly platform: string;

  /**
   * Gets the window control operations for the application window.
   */
  readonly windowControls: WindowControlsApi;

  /**
   * Gets the pseudo-terminal operations for the application.
   */
  readonly terminal: TerminalApi;
}
