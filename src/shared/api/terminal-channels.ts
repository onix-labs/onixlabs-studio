/**
 * Names the pseudo-terminal (pty) IPC channels. This is the terminal capability's slice of the IPC
 * contract: the shared `<app-terminal>` wrapper's renderer client and the main-process terminal
 * manager both name their channels from here, over the generic {@link import('./bridge').Bridge}
 * transport. The pty backing is shared (not feature-owned) because the terminal component that needs
 * it is shared kitchen.
 */
export enum TerminalChannel {
  /**
   * Requests that a new pseudo-terminal session be spawned (renderer→main, invoke).
   */
  Create = 'terminal:create',

  /**
   * Writes input data to a session (renderer→main, invoke).
   */
  Write = 'terminal:write',

  /**
   * Resizes a session to a new column/row count (renderer→main, invoke).
   */
  Resize = 'terminal:resize',

  /**
   * Disposes (kills) a session (renderer→main, invoke).
   */
  Dispose = 'terminal:dispose',

  /**
   * Requests the current working directory of a session (renderer→main, invoke).
   */
  GetCwd = 'terminal:get-cwd',

  /**
   * Requests the list of shells installed on the host, for the shell picker (renderer→main, invoke).
   */
  ListShells = 'terminal:list-shells',

  /**
   * Requests a session's retained scrollback snapshot, so a re-attaching terminal pane can replay the
   * output it missed while no pane was mounted (renderer→main, invoke).
   */
  Replay = 'terminal:replay',

  /**
   * Carries output data from a session to the renderer, with the chunk's sequence number in the
   * session's output stream so a replaying pane can discard chunks its snapshot already contains
   * (main→renderer, send).
   */
  Data = 'terminal:data',

  /**
   * Notifies the renderer that a session has exited (main→renderer, send).
   */
  Exit = 'terminal:exit',
}

/**
 * Defines the options for spawning a pseudo-terminal session.
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

  /**
   * Gets the shell executable to run. Falls back to the main process's resolved default when absent or
   * not a usable executable.
   */
  readonly shell?: string;
}

/**
 * Describes a shell installed on the host, offered by the shell picker.
 */
export interface ShellInfo {
  /**
   * Gets the display name of the shell (its executable's base name, for example `zsh`).
   */
  readonly name: string;

  /**
   * Gets the absolute path to the shell executable.
   */
  readonly path: string;
}

/**
 * Defines a session's retained scrollback snapshot, replayed into a re-attaching terminal pane. The
 * main process retains each session's recent output (and its exit, when it has ended) so a pane that
 * was unmounted — for example while another tool tab was active — can restore what it missed.
 */
export interface TerminalReplay {
  /**
   * Gets the retained output, bounded to the most recent span of the session's stream.
   */
  readonly data: string;

  /**
   * Gets the sequence number of the last output chunk the snapshot includes; live chunks bearing a
   * sequence number at or below this are already part of {@link data}.
   */
  readonly seq: number;

  /**
   * Gets the exit code the session's process ended with, or null while it is still running (or was
   * never started).
   */
  readonly exitCode: number | null;
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
