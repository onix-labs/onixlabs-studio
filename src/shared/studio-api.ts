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

  /**
   * Sets whether the application window may be moved by dragging its draggable regions.
   * @param movable True to allow the window to be moved; false to lock it in place.
   */
  setMovable(movable: boolean): void;
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
 * Describes a file read from disk.
 */
export interface FileInfo {
  /**
   * Gets the absolute path of the file.
   */
  readonly path: string;

  /**
   * Gets the file name, including its extension.
   */
  readonly name: string;

  /**
   * Gets the file extension, including the leading dot (empty when there is none).
   */
  readonly extension: string;

  /**
   * Gets the textual contents of the file.
   */
  readonly content: string;
}

/**
 * Describes the result of a file write.
 */
export interface FileWriteResult {
  /**
   * Gets a value indicating whether the write succeeded.
   */
  readonly success: boolean;

  /**
   * Gets the absolute path written to, when successful.
   */
  readonly path?: string;

  /**
   * Gets the error message, when the write failed.
   */
  readonly error?: string;
}

/**
 * Identifies the user's choice in the unsaved-changes confirmation dialog.
 */
export type SaveDialogChoice = 'save' | 'dontSave' | 'cancel';

/**
 * Defines the file-system operations exposed to the renderer process. All paths are validated in the
 * main process before any disk access.
 */
export interface FileApi {
  /**
   * Reads a file from disk.
   * @param path The absolute path of the file to read.
   * @returns Returns the file info, or null when the file cannot be read.
   */
  read(path: string): Promise<FileInfo | null>;

  /**
   * Writes contents to a file on disk.
   * @param path The absolute path to write to.
   * @param content The contents to write.
   * @returns Returns the result describing success or failure.
   */
  write(path: string, content: string): Promise<FileWriteResult>;

  /**
   * Shows an open-file dialog and reads the chosen file.
   * @returns Returns the chosen file's info, or null when the dialog was cancelled.
   */
  openDialog(): Promise<FileInfo | null>;

  /**
   * Shows a save-file dialog and returns the chosen path.
   * @param defaultPath The path suggested in the dialog.
   * @returns Returns the chosen absolute path, or null when the dialog was cancelled.
   */
  saveDialog(defaultPath?: string): Promise<string | null>;

  /**
   * Shows a confirmation dialog asking whether to save unsaved changes.
   * @param fileName The name of the file with unsaved changes.
   * @returns Returns the user's choice.
   */
  confirmSave(fileName: string): Promise<SaveDialogChoice>;
}

/**
 * Describes the result of writing a temporary file for code execution.
 */
export interface TempFileResult {
  /**
   * Gets a value indicating whether the temporary file was written.
   */
  readonly success: boolean;

  /**
   * Gets the absolute path of the temporary file, when successful.
   */
  readonly path?: string;

  /**
   * Gets the error message, when the write failed.
   */
  readonly error?: string;
}

/**
 * Defines the code-execution operations exposed to the renderer process.
 */
export interface RunApi {
  /**
   * Writes editor content to a stable per-key temporary file and returns its path, so a language
   * runner can execute it.
   * @param key A stable key (the owning tab's id) that selects the temporary file.
   * @param extension The file extension to give the temporary file.
   * @param content The content to write.
   * @returns Returns the result describing success and the file path.
   */
  writeTempFile(key: string, extension: string, content: string): Promise<TempFileResult>;
}

/**
 * Identifies whether a directory entry is a file or a directory.
 */
export type DirectoryEntryType = 'file' | 'directory';

/**
 * Describes a single immediate child of a directory.
 */
export interface DirectoryEntry {
  /**
   * Gets the entry's base name (for example, `main.ts`).
   */
  readonly name: string;

  /**
   * Gets the entry's absolute path.
   */
  readonly path: string;

  /**
   * Gets whether the entry is a file or a directory.
   */
  readonly type: DirectoryEntryType;
}

/**
 * Describes a shallow listing of a directory's immediate children.
 */
export interface DirectoryListing {
  /**
   * Gets the directory's absolute path.
   */
  readonly path: string;

  /**
   * Gets the directory's base name.
   */
  readonly name: string;

  /**
   * Gets the directory's immediate children, ordered directories-first then by name.
   */
  readonly entries: readonly DirectoryEntry[];
}

/**
 * Describes the result of a workspace mutation (create, rename, or delete).
 */
export interface FileOperationResult {
  /**
   * Gets a value indicating whether the operation succeeded.
   */
  readonly success: boolean;

  /**
   * Gets the absolute path the operation produced, when successful.
   */
  readonly path?: string;

  /**
   * Gets the error message, when the operation failed.
   */
  readonly error?: string;
}

/**
 * Describes the outcome of a combined open request: a directory to open as the workspace, a text
 * file to open in an editor, or a binary file that is recognised but not opened as text.
 */
export type OpenSelection =
  | { readonly kind: 'directory'; readonly directory: DirectoryListing }
  | { readonly kind: 'file'; readonly file: FileInfo }
  | { readonly kind: 'binary'; readonly path: string };

/**
 * Defines the workspace (open folder) and directory operations exposed to the renderer process. All
 * path-taking operations are confined to the open workspace root in the main process before any disk
 * access, so the renderer cannot read or write arbitrary locations.
 */
export interface WorkspaceApi {
  /**
   * Shows a combined open dialog allowing either a file or a folder to be chosen. Choosing a folder
   * sets it as the workspace root; choosing a file returns its contents (or a binary marker).
   * @returns Returns the selection, or null when the dialog was cancelled.
   */
  open(): Promise<OpenSelection | null>;

  /**
   * Reads a single file within the workspace for opening in an editor.
   * @param path The absolute path of the file to read; must be inside the workspace.
   * @returns Returns the file selection (text or binary), or null when invalid or outside the workspace.
   */
  openFile(path: string): Promise<OpenSelection | null>;

  /**
   * Shows an open-folder dialog and, when a folder is chosen, sets it as the workspace root.
   * @returns Returns the root directory listing, or null when the dialog was cancelled.
   */
  openFolder(): Promise<DirectoryListing | null>;

  /**
   * Clears the current workspace root, closing the open folder.
   */
  closeFolder(): Promise<void>;

  /**
   * Reads the immediate children of a directory within the workspace.
   * @param path The absolute directory path to read.
   * @returns Returns the listing, or null when the path is invalid or outside the workspace.
   */
  readDirectory(path: string): Promise<DirectoryListing | null>;

  /**
   * Creates an empty file inside a workspace directory.
   * @param directoryPath The parent directory.
   * @param name The new file's name (a single path segment).
   * @returns Returns the result describing success or failure.
   */
  createFile(directoryPath: string, name: string): Promise<FileOperationResult>;

  /**
   * Creates a folder inside a workspace directory.
   * @param directoryPath The parent directory.
   * @param name The new folder's name (a single path segment).
   * @returns Returns the result describing success or failure.
   */
  createFolder(directoryPath: string, name: string): Promise<FileOperationResult>;

  /**
   * Renames a file or folder within the workspace, keeping it in the same directory.
   * @param targetPath The absolute path of the entry to rename.
   * @param newName The new name (a single path segment).
   * @returns Returns the result describing success and the new path.
   */
  rename(targetPath: string, newName: string): Promise<FileOperationResult>;

  /**
   * Deletes a file or folder within the workspace.
   * @param targetPath The absolute path of the entry to delete.
   * @returns Returns the result describing success or failure.
   */
  delete(targetPath: string): Promise<FileOperationResult>;
}

/**
 * Defines the operating-system shell operations exposed to the renderer process.
 */
export interface ShellApi {
  /**
   * Opens a file-system path in the operating system's default handler (e.g. the file manager).
   * @param path The absolute path to open.
   */
  openPath(path: string): Promise<void>;
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

  /**
   * Gets the operating-system shell operations for the application.
   */
  readonly shell: ShellApi;

  /**
   * Gets the file-system operations for the application.
   */
  readonly file: FileApi;

  /**
   * Gets the code-execution operations for the application.
   */
  readonly run: RunApi;

  /**
   * Gets the workspace (open folder) and directory operations for the application.
   */
  readonly workspace: WorkspaceApi;
}
