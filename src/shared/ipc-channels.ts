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
   * Asks the renderer to confirm/save unsaved work before the window closes (main to renderer).
   */
  AppRequestClose = 'app:request-close',

  /**
   * Carries the renderer's decision on whether the window may close (renderer to main).
   */
  AppConfirmClose = 'app:confirm-close',

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
   * Requests that an external URL be opened in the operating system's default browser.
   */
  ShellOpenExternal = 'shell:open-external',

  /**
   * Gets the current image-source Content-Security-Policy.
   */
  SecurityGetImagePolicy = 'security:get-image-policy',

  /**
   * Sets the image-source Content-Security-Policy.
   */
  SecuritySetImagePolicy = 'security:set-image-policy',

  /**
   * Reads the contents of a file from disk.
   */
  FileRead = 'file:read',

  /**
   * Writes contents to a file on disk.
   */
  FileWrite = 'file:write',

  /**
   * Begins watching a file on disk for changes.
   */
  FileWatch = 'file:watch',

  /**
   * Stops watching a file on disk for changes.
   */
  FileUnwatch = 'file:unwatch',

  /**
   * Notifies the renderer that a watched file changed on disk.
   */
  FileChanged = 'file:changed',

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

  /**
   * Loads the logical project model (solution and projects) for a workspace root.
   */
  ProjectModelLoad = 'project:model-load',

  /**
   * Loads a single project's logical contents (its files), on demand.
   */
  ProjectItemsLoad = 'project:items-load',

  /**
   * Gets the agent's current authentication status.
   */
  AiAuthStatus = 'ai:auth-status',

  /**
   * Stores a user-supplied API key for the agent.
   */
  AiSetApiKey = 'ai:set-api-key',

  /**
   * Clears any stored agent API key.
   */
  AiClearApiKey = 'ai:clear-api-key',

  /**
   * Runs a minimal agent turn to verify authentication end-to-end.
   */
  AiVerify = 'ai:verify',

  /**
   * Lists the registered agent providers and their availability.
   */
  AiListProviders = 'ai:list-providers',

  /**
   * Starts an agent turn.
   */
  AiRun = 'ai:run',

  /**
   * Aborts a running agent turn.
   */
  AiAbort = 'ai:abort',

  /**
   * Carries a streamed event from a running agent turn to the renderer.
   */
  AiEvent = 'ai:event',

  /**
   * Carries an in-app capability request from the main process to the renderer.
   */
  AiBridgeRequest = 'ai:bridge-request',

  /**
   * Carries the renderer's reply to an in-app capability request.
   */
  AiBridgeReply = 'ai:bridge-reply',

  /**
   * Carries the renderer's answer to an agent permission request.
   */
  AiPermissionReply = 'ai:permission-reply',

  /**
   * Starts a language-server session and runs its initialize handshake.
   */
  LspStart = 'lsp:start',

  /**
   * Stops a language-server session and terminates its process.
   */
  LspStop = 'lsp:stop',

  /**
   * Sends an LSP notification from the renderer to a session's server.
   */
  LspNotify = 'lsp:notify',

  /**
   * Sends an LSP request from the renderer to a session's server and awaits its response.
   */
  LspRequest = 'lsp:request',

  /**
   * Carries an LSP notification from a session's server to the renderer.
   */
  LspNotification = 'lsp:notification',

  /**
   * Notifies the renderer that a session's server process has exited.
   */
  LspServerExit = 'lsp:server-exit',

  /**
   * Notifies the renderer of a workspace-load lifecycle event (a project finished loading, or the
   * whole workspace started or finished), so the Solution Explorer can show per-project load state.
   */
  LspProjectLoad = 'lsp:project-load',

  /**
   * Gets the user's language-server settings.
   */
  LspGetSettings = 'lsp:get-settings',

  /**
   * Stores the user's language-server settings.
   */
  LspSetSettings = 'lsp:set-settings',

  /**
   * Runs a task as a child process whose output streams back to the renderer.
   */
  TaskRun = 'tasks:run',

  /**
   * Cancels a running task, terminating its process.
   */
  TaskCancel = 'tasks:cancel',

  /**
   * Carries a chunk of output from a running task to the renderer.
   */
  TaskOutput = 'tasks:output',

  /**
   * Notifies the renderer that a task's process has exited.
   */
  TaskExit = 'tasks:exit',
}
