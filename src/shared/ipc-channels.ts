// Shared IPC channel names used between the Electron main process and the renderer.
// Keep this module platform-neutral (no Node or DOM dependencies) so both compilation
// targets can import it.

/**
 * Specifies the IPC channel names used for communication between the renderer and main processes.
 */
export enum IpcChannel {
  /**
   * Requests that the application window be minimized.
   */
  WindowMinimize = 'window:minimize',

  /**
   * Requests that the application window toggle between its maximized and restored states.
   */
  WindowToggleMaximize = 'window:toggle-maximize',

  /**
   * Requests that the application window be closed.
   */
  WindowClose = 'window:close',

  /**
   * Requests that a new pseudo-terminal session be spawned.
   */
  TerminalCreate = 'terminal:create',

  /**
   * Writes input data to a pseudo-terminal session.
   */
  TerminalWrite = 'terminal:write',

  /**
   * Resizes a pseudo-terminal session to a new column/row count.
   */
  TerminalResize = 'terminal:resize',

  /**
   * Disposes (kills) a pseudo-terminal session.
   */
  TerminalDispose = 'terminal:dispose',

  /**
   * Requests the current working directory of a pseudo-terminal session.
   */
  TerminalGetCwd = 'terminal:get-cwd',

  /**
   * Carries output data from a pseudo-terminal session to the renderer.
   */
  TerminalData = 'terminal:data',

  /**
   * Notifies the renderer that a pseudo-terminal session has exited.
   */
  TerminalExit = 'terminal:exit',

  /**
   * Requests that a file-system path be opened in the operating system's default handler.
   */
  ShellOpenPath = 'shell:open-path',
}
