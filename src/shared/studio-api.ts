// Shared contract between the Electron (back-end) and Angular (front-end) processes.
// The preload script implements this API and exposes it on `window.studio`; the
// renderer consumes it. Keep this module platform-neutral (types only — no Node or
// DOM dependencies) so both compilation targets can import it.

import type { AiApi } from './ai-types';

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

  /**
   * Fetches all remotes, pruning deleted remote-tracking branches.
   * @param root The absolute repository root; must be an open root.
   * @returns Returns the raw command result.
   */
  fetch(root: string): Promise<GitRunResult>;

  /**
   * Pulls the current branch from its upstream.
   * @param root The absolute repository root; must be an open root.
   * @returns Returns the raw command result.
   */
  pull(root: string): Promise<GitRunResult>;

  /**
   * Pushes the current branch to its upstream. When a remote and branch are given, the upstream is
   * set on the push (used for a branch that has none yet); otherwise the configured upstream is used.
   * @param root The absolute repository root; must be an open root.
   * @param remote The remote to set the upstream to, or undefined to push to the existing upstream.
   * @param branch The branch to set the upstream to, or undefined to push to the existing upstream.
   * @returns Returns the raw command result.
   */
  push(root: string, remote?: string, branch?: string): Promise<GitRunResult>;
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
   * Gets the operating-system shell operations for the application.
   */
  readonly shell: ShellApi;

  /**
   * Gets the AI-agent authentication and verification operations for the application.
   */
  readonly ai: AiApi;

  /**
   * Gets the version-control (git) operations for the application.
   */
  readonly sourceControl: SourceControlApi;
}
