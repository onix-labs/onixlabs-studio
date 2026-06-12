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
   * Sets whether the application window may be moved by dragging its draggable regions.
   */
  WindowSetMovable = 'window:set-movable',

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

  /**
   * Reads the contents of a file from disk.
   */
  FileRead = 'file:read',

  /**
   * Writes contents to a file on disk.
   */
  FileWrite = 'file:write',

  /**
   * Shows an open-file dialog and reads the chosen file.
   */
  DialogOpenFile = 'dialog:open-file',

  /**
   * Shows a save-file dialog and returns the chosen path.
   */
  DialogSaveFile = 'dialog:save-file',

  /**
   * Shows a confirmation dialog for saving unsaved changes before closing.
   */
  DialogConfirmSave = 'dialog:confirm-save',

  /**
   * Writes editor content to a per-key temporary file so a language runner can execute it.
   */
  RunWriteTempFile = 'run:write-temp-file',

  /**
   * Shows a combined open dialog allowing either a file or a folder to be chosen.
   */
  WorkspaceOpen = 'workspace:open',

  /**
   * Reads a single file within the workspace for opening in an editor.
   */
  WorkspaceOpenFile = 'workspace:open-file',

  /**
   * Shows an open-folder dialog and, when chosen, sets it as the workspace root.
   */
  WorkspaceOpenFolder = 'workspace:open-folder',

  /**
   * Clears the current workspace root, closing the open folder.
   */
  WorkspaceCloseFolder = 'workspace:close-folder',

  /**
   * Reads the immediate children of a directory within the workspace.
   */
  WorkspaceReadDirectory = 'workspace:read-directory',

  /**
   * Creates an empty file inside a workspace directory.
   */
  WorkspaceCreateFile = 'workspace:create-file',

  /**
   * Creates a folder inside a workspace directory.
   */
  WorkspaceCreateFolder = 'workspace:create-folder',

  /**
   * Renames a file or folder within the workspace.
   */
  WorkspaceRename = 'workspace:rename',

  /**
   * Deletes a file or folder within the workspace.
   */
  WorkspaceDelete = 'workspace:delete',
}
