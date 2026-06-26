// Shared contract between the Electron (back-end) and Angular (front-end) processes.
// The preload script implements this API and exposes it on `window.studio`; the
// renderer consumes it. Keep this module platform-neutral (types only — no Node or
// DOM dependencies) so both compilation targets can import it.

import type { AiApi } from './ai-types';
import type { LspApi } from './lsp-types';
import type { ProjectItems, ProjectModel } from './project-system';
import type { SecurityApi } from './security-types';
import type { TaskApi } from './task-types';

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
 * Defines the application-lifecycle operations exposed to the renderer process.
 */
export interface AppApi {
  /**
   * Subscribes to the main process's request to close the window, giving the renderer a chance to
   * confirm or save unsaved work. The handler must eventually answer with {@link respondClose}.
   * @param listener Invoked when the main process wants to close the window.
   * @returns Returns a function that removes the listener.
   */
  onRequestClose(listener: () => void): () => void;

  /**
   * Tells the main process whether the window may close.
   * @param proceed True to allow the window to close; false to keep it open.
   */
  respondClose(proceed: boolean): void;
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
   * Gets the textual contents of the file, with any leading byte-order mark removed.
   */
  readonly content: string;

  /**
   * Gets the text encoding the file was read as (currently always "UTF-8"). Absent on file infos
   * synthesised outside the read path, where the consumer assumes UTF-8.
   */
  readonly encoding?: string;

  /**
   * Gets a value indicating whether the file began with a UTF-8 byte-order mark, so it can be
   * preserved when the file is written back. Absent (treated as false) on synthesised file infos.
   */
  readonly hasBom?: boolean;
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
   * @param hasBom Whether to prefix the contents with a UTF-8 byte-order mark. Defaults to false.
   * @returns Returns the result describing success or failure.
   */
  write(path: string, content: string, hasBom?: boolean): Promise<FileWriteResult>;

  /**
   * Shows an open-file dialog and reads the chosen file.
   * @returns Returns the chosen file's info, or null when the dialog was cancelled.
   */
  openDialog(): Promise<FileInfo | null>;

  /**
   * Shows an open-image dialog and returns the chosen file's absolute path. Unlike {@link openDialog}
   * the file's contents are not read, so it is suitable for referencing large binary images.
   * @returns Returns the chosen image's absolute path, or null when the dialog was cancelled.
   */
  pickImage(): Promise<string | null>;

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

  /**
   * Begins watching a file on disk; subsequent changes are delivered through {@link onChanged}.
   * Watching is reference-counted, so balanced {@link watch}/{@link unwatch} calls are required.
   * @param path The absolute path of the file to watch.
   */
  watch(path: string): Promise<void>;

  /**
   * Stops watching a file on disk.
   * @param path The absolute path of the file to stop watching.
   */
  unwatch(path: string): Promise<void>;

  /**
   * Subscribes to change notifications for watched files.
   * @param listener Receives the absolute path of the file that changed.
   * @returns Returns a function that removes the listener.
   */
  onChanged(listener: (path: string) => void): () => void;
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
/**
 * Defines the project-system operations exposed to the renderer: resolving the logical project model
 * (solution and projects) the Solution Explorer renders for a workspace root.
 */
export interface ProjectApi {
  /**
   * Loads the logical project model for a workspace root.
   * @param root The absolute workspace root path; must be an open root.
   * @returns Returns the model, or null when the root has no recognized project system.
   */
  loadModel(root: string): Promise<ProjectModel | null>;

  /**
   * Loads a single project's logical contents (its files), on demand when its node is expanded.
   * @param projectPath The absolute project-file path; must be within an open workspace.
   * @returns Returns the contents, or null when they could not be loaded.
   */
  loadItems(projectPath: string): Promise<ProjectItems | null>;
}

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
   * Closes an open workspace folder, removing it from the set of roots filesystem operations are
   * confined to.
   * @param root The absolute root path to close.
   */
  closeFolder(root: string): Promise<void>;

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

  /**
   * Opens an external URL in the operating system's default browser. Only http, https, and mailto
   * URLs are honoured; anything else is ignored.
   * @param url The URL to open.
   */
  openExternal(url: string): Promise<void>;
}

/**
 * Describes the GPU-derived rendering recommendation resolved by the main process at startup. The
 * renderer uses it to seed (and explain) the "modern UI features" setting when that setting is left
 * on its automatic mode.
 */
export interface GpuRenderingInfo {
  /**
   * Gets a value indicating whether the active GPU is flagged as likely to render the heavier visual
   * effects poorly, so the renderer should fall back to plain rounded corners and reduced decorative
   * effects. Some GPUs (notably the Intel UHD 630) corrupt the GPU-rasterized squircle corner masks.
   */
  readonly recommendReducedEffects: boolean;

  /**
   * Gets a human-readable description of the active GPU (for example, its OpenGL renderer string),
   * shown in the settings hint. Empty when the GPU could not be identified.
   */
  readonly description: string;
}

/**
 * Defines the display and GPU-rendering operations exposed to the renderer process. Combines the
 * read-only startup state (resolved before the first paint) with the operations needed to change
 * the startup-only hardware-acceleration preference.
 */
export interface DisplayApi {
  /**
   * Gets the GPU-derived rendering recommendation resolved at startup.
   */
  readonly gpuRendering: GpuRenderingInfo;

  /**
   * Gets a value indicating whether GPU hardware acceleration is currently enabled. Reflects the
   * persisted preference applied at this launch; a change made via
   * {@link DisplayApi.setHardwareAcceleration} only takes effect after a relaunch.
   */
  readonly hardwareAccelerationEnabled: boolean;

  /**
   * Persists the GPU hardware-acceleration preference. The change takes effect after the next
   * relaunch, since hardware acceleration can only be toggled before the app is ready.
   * @param enabled Whether hardware acceleration should be enabled on the next launch.
   */
  setHardwareAcceleration(enabled: boolean): Promise<void>;

  /**
   * Relaunches the application so a startup-only preference change can take effect.
   */
  relaunch(): void;
}

/**
 * Defines the minimal, sandboxed API surface exposed to the renderer process via
 * the context bridge. This is the only channel through which the renderer reaches
 * privileged capability.
 */
/**
 * Describes an opened version-control repository: its resolved root path and display name.
 */
export interface RepositoryInfo {
  /**
   * Gets the repository's absolute root path (the git top level).
   */
  readonly root: string;

  /**
   * Gets the repository's display name (its root folder's base name).
   */
  readonly name: string;
}

/**
 * Describes the outcome of a single git invocation. The command's standard output is returned raw for
 * the renderer-side provider to parse; failures carry the error (and any standard error) instead.
 */
export interface GitRunResult {
  /**
   * Gets a value indicating whether the command exited successfully.
   */
  readonly success: boolean;

  /**
   * Gets the command's standard output, when it succeeded.
   */
  readonly stdout?: string;

  /**
   * Gets the command's standard error, when present.
   */
  readonly stderr?: string;

  /**
   * Gets the error message, when the command failed or the request was rejected.
   */
  readonly error?: string;
}

/**
 * Defines the version-control operations exposed to the renderer process. The git CLI is invoked in
 * the main process with array arguments (never a shell), its variable arguments validated, and every
 * operation confined to a repository root the user has explicitly opened — the renderer is treated as
 * hostile. Output is returned raw for the renderer's source-control provider to parse and map.
 */
export interface SourceControlApi {
  /**
   * Shows an open-folder dialog and resolves the chosen folder's enclosing git repository root.
   * @returns Returns the repository, or null when cancelled or the folder is not a git repository.
   */
  openRepository(): Promise<RepositoryInfo | null>;

  /**
   * Resolves the git repository root that contains an already-open folder, without a dialog.
   * @param directory The absolute folder path to resolve from.
   * @returns Returns the repository, or null when the folder is not inside a git repository.
   */
  resolveRepository(directory: string): Promise<RepositoryInfo | null>;

  /**
   * Releases an open repository root, removing it from the set git operations are confined to.
   * @param root The absolute repository root to release.
   */
  closeRepository(root: string): Promise<void>;

  /**
   * Reads the working-tree status of a repository (porcelain v2, with the branch header).
   * @param root The absolute repository root; must be an open root.
   * @returns Returns the raw command result.
   */
  status(root: string): Promise<GitRunResult>;

  /**
   * Reads the commit history of a repository, with parent hashes and ref decorations.
   * @param root The absolute repository root; must be an open root.
   * @param limit The maximum number of commits to read.
   * @returns Returns the raw command result.
   */
  log(root: string, limit: number): Promise<GitRunResult>;

  /**
   * Reads the branches and tags of a repository (local heads, remote-tracking heads, and tags).
   * @param root The absolute repository root; must be an open root.
   * @returns Returns the raw command result.
   */
  refs(root: string): Promise<GitRunResult>;

  /**
   * Reads the stash entries of a repository.
   * @param root The absolute repository root; must be an open root.
   * @returns Returns the raw command result.
   */
  stashes(root: string): Promise<GitRunResult>;

  /**
   * Reads the files changed by a single commit (name-status against its first parent).
   * @param root The absolute repository root; must be an open root.
   * @param hash The commit hash to inspect.
   * @returns Returns the raw command result.
   */
  commitFiles(root: string, hash: string): Promise<GitRunResult>;

  /**
   * Reads the contents of a file at a revision for one side of a diff. An empty revision reads the
   * working-tree file from disk; otherwise the file is read from the git object at `revision:path`.
   * @param root The absolute repository root; must be an open root.
   * @param revision The revision to read at (for example `HEAD`, a commit hash, `<hash>^`, or `:` for
   * the index), or an empty string for the working tree.
   * @param filePath The repository-relative file path.
   * @returns Returns the raw command result; a missing file yields an empty string.
   */
  readBlob(root: string, revision: string, filePath: string): Promise<GitRunResult>;

  /**
   * Stages files into the index, or the whole working tree when no paths are given.
   * @param root The absolute repository root; must be an open root.
   * @param paths The repository-relative paths to stage, or an empty array to stage everything.
   * @returns Returns the raw command result.
   */
  stage(root: string, paths: readonly string[]): Promise<GitRunResult>;

  /**
   * Unstages files from the index, or the whole index when no paths are given.
   * @param root The absolute repository root; must be an open root.
   * @param paths The repository-relative paths to unstage, or an empty array to unstage everything.
   * @returns Returns the raw command result.
   */
  unstage(root: string, paths: readonly string[]): Promise<GitRunResult>;

  /**
   * Commits the staged changes with a message.
   * @param root The absolute repository root; must be an open root.
   * @param message The commit message.
   * @returns Returns the raw command result.
   */
  commit(root: string, message: string): Promise<GitRunResult>;

  /**
   * Stashes the working-tree changes.
   * @param root The absolute repository root; must be an open root.
   * @returns Returns the raw command result.
   */
  stash(root: string): Promise<GitRunResult>;

  /**
   * Checks out an existing branch.
   * @param root The absolute repository root; must be an open root.
   * @param branch The branch name to check out.
   * @returns Returns the raw command result.
   */
  checkout(root: string, branch: string): Promise<GitRunResult>;

  /**
   * Creates a branch at the current head and checks it out.
   * @param root The absolute repository root; must be an open root.
   * @param name The new branch name.
   * @returns Returns the raw command result.
   */
  createBranch(root: string, name: string): Promise<GitRunResult>;
}

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
   * Gets the display and GPU-rendering operations, including the startup rendering recommendation
   * and the hardware-acceleration preference.
   */
  readonly display: DisplayApi;

  /**
   * Gets the window control operations for the application window.
   */
  readonly windowControls: WindowControlsApi;

  /**
   * Gets the application-lifecycle operations for the application.
   */
  readonly app: AppApi;

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

  /**
   * Gets the project-system operations (the logical solution/project model) for the application.
   */
  readonly project: ProjectApi;

  /**
   * Gets the AI-agent authentication and verification operations for the application.
   */
  readonly ai: AiApi;

  /**
   * Gets the security operations for the application.
   */
  readonly security: SecurityApi;

  /**
   * Gets the language-server (LSP) operations for the application.
   */
  readonly lsp: LspApi;

  /**
   * Gets the task-runner operations for the application.
   */
  readonly tasks: TaskApi;

  /**
   * Gets the version-control (git) operations for the application.
   */
  readonly sourceControl: SourceControlApi;
}
