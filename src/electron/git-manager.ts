import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import {
  BrowserWindow,
  dialog,
  ipcMain,
  IpcMainInvokeEvent,
  OpenDialogReturnValue,
} from 'electron';
import { IpcChannel } from '../shared/ipc-channels';
import { GitRunResult, RepositoryInfo } from '../shared/studio-api';

/**
 * Holds the maximum time, in milliseconds, a single git invocation may run before being killed.
 */
const GIT_TIMEOUT_MS: number = 20000;

/**
 * Holds the maximum size, in bytes, of a git invocation's captured output (large logs and blobs).
 */
const GIT_MAX_BUFFER: number = 64 * 1024 * 1024;

/**
 * Holds the largest commit count {@link GitManager.log} will read, clamping an untrusted limit.
 */
const MAX_LOG_LIMIT: number = 2000;

/**
 * Holds the maximum time, in milliseconds, a network git invocation (fetch/pull/push) may run. These
 * contact a remote, so they are given a longer budget than the local-operation default.
 */
const GIT_NETWORK_TIMEOUT_MS: number = 120000;

/**
 * Holds the environment overlay applied to network git invocations so they never block on an
 * interactive prompt. With no usable credentials git fails fast (and we surface its stderr) rather
 * than hanging until the timeout: `GIT_TERMINAL_PROMPT=0` stops terminal username/password prompts,
 * and a non-interactive `GIT_SSH_COMMAND` stops ssh from prompting. Credentials still come from the
 * user's configured git credential helper and ssh-agent; this only disables interactive fallback.
 */
const GIT_NETWORK_ENV: NodeJS.ProcessEnv = {
  GIT_TERMINAL_PROMPT: '0',
  GIT_SSH_COMMAND: 'ssh -o BatchMode=yes -o ConnectTimeout=10',
};

/**
 * Validates the variable arguments passed to git so the renderer cannot smuggle options. A safe value
 * is a non-empty string that does not begin with a dash (which git would parse as an option).
 * @param value The value to validate.
 * @returns Returns true when the value is safe to pass as a git operand.
 */
function isSafeOperand(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !value.startsWith('-');
}

/**
 * Runs the git CLI safely on behalf of the renderer. Every invocation uses `execFile` with array
 * arguments (never a shell), runs with its working directory set to a repository root the user has
 * explicitly opened, and has its variable arguments validated so no argument can be parsed as an
 * option. Output is returned raw for the renderer's source-control provider to parse.
 *
 * This is the git implementation behind the renderer's `SourceControlProvider`; a future provider
 * (for example SVN) would add its own manager alongside this one.
 */
export class GitManager {
  /**
   * Holds the accessor for the current application window, used to parent the open dialog.
   */
  private readonly windowGetter: () => BrowserWindow | null;

  /**
   * Holds the absolute repository roots git operations are confined to, each with an open count.
   * Several surfaces (a source-control tab and a workspace tab) can open the same root independently,
   * so it is reference-counted: opened when a surface binds it, released when one unbinds, and removed
   * only when the last release brings the count to zero. Every operation is rejected unless its root
   * is present.
   */
  private readonly roots: Map<string, number> = new Map<string, number>();

  /**
   * Initialises a new instance of the {@link GitManager} class.
   * @param windowGetter Returns the current application window, or null when none is open.
   */
  public constructor(windowGetter: () => BrowserWindow | null) {
    this.windowGetter = windowGetter;
  }

  /**
   * Registers the source-control IPC handlers.
   */
  public register(): void {
    ipcMain.handle(
      IpcChannel.SourceControlOpenRepository,
      (): Promise<RepositoryInfo | null> => this.openRepository(),
    );
    ipcMain.handle(
      IpcChannel.SourceControlResolveRepository,
      (_event: IpcMainInvokeEvent, directory: unknown): Promise<RepositoryInfo | null> =>
        this.resolveRepository(directory),
    );
    ipcMain.handle(
      IpcChannel.SourceControlCloseRepository,
      (_event: IpcMainInvokeEvent, root: unknown): void => this.closeRepository(root),
    );
    ipcMain.handle(
      IpcChannel.SourceControlStatus,
      (_event: IpcMainInvokeEvent, root: unknown): Promise<GitRunResult> => this.status(root),
    );
    ipcMain.handle(
      IpcChannel.SourceControlLog,
      (_event: IpcMainInvokeEvent, root: unknown, limit: unknown): Promise<GitRunResult> =>
        this.log(root, limit),
    );
    ipcMain.handle(
      IpcChannel.SourceControlRefs,
      (_event: IpcMainInvokeEvent, root: unknown): Promise<GitRunResult> => this.refs(root),
    );
    ipcMain.handle(
      IpcChannel.SourceControlStashes,
      (_event: IpcMainInvokeEvent, root: unknown): Promise<GitRunResult> => this.stashes(root),
    );
    ipcMain.handle(
      IpcChannel.SourceControlCommitFiles,
      (_event: IpcMainInvokeEvent, root: unknown, hash: unknown): Promise<GitRunResult> =>
        this.commitFiles(root, hash),
    );
    ipcMain.handle(
      IpcChannel.SourceControlReadBlob,
      (
        _event: IpcMainInvokeEvent,
        root: unknown,
        revision: unknown,
        filePath: unknown,
      ): Promise<GitRunResult> => this.readBlob(root, revision, filePath),
    );
    ipcMain.handle(
      IpcChannel.SourceControlStage,
      (_event: IpcMainInvokeEvent, root: unknown, paths: unknown): Promise<GitRunResult> =>
        this.stage(root, paths),
    );
    ipcMain.handle(
      IpcChannel.SourceControlUnstage,
      (_event: IpcMainInvokeEvent, root: unknown, paths: unknown): Promise<GitRunResult> =>
        this.unstage(root, paths),
    );
    ipcMain.handle(
      IpcChannel.SourceControlCommit,
      (_event: IpcMainInvokeEvent, root: unknown, message: unknown): Promise<GitRunResult> =>
        this.commit(root, message),
    );
    ipcMain.handle(
      IpcChannel.SourceControlStash,
      (_event: IpcMainInvokeEvent, root: unknown): Promise<GitRunResult> => this.stash(root),
    );
    ipcMain.handle(
      IpcChannel.SourceControlCheckout,
      (_event: IpcMainInvokeEvent, root: unknown, branch: unknown): Promise<GitRunResult> =>
        this.checkout(root, branch),
    );
    ipcMain.handle(
      IpcChannel.SourceControlCreateBranch,
      (_event: IpcMainInvokeEvent, root: unknown, name: unknown): Promise<GitRunResult> =>
        this.createBranch(root, name),
    );
    ipcMain.handle(
      IpcChannel.SourceControlFetch,
      (_event: IpcMainInvokeEvent, root: unknown): Promise<GitRunResult> => this.fetch(root),
    );
    ipcMain.handle(
      IpcChannel.SourceControlPull,
      (_event: IpcMainInvokeEvent, root: unknown): Promise<GitRunResult> => this.pull(root),
    );
    ipcMain.handle(
      IpcChannel.SourceControlPush,
      (
        _event: IpcMainInvokeEvent,
        root: unknown,
        remote: unknown,
        branch: unknown,
      ): Promise<GitRunResult> => this.push(root, remote, branch),
    );
  }

  /**
   * Shows an open-folder dialog and resolves the chosen folder's enclosing git repository root,
   * opening it for subsequent operations.
   * @returns Returns the repository, or null when cancelled or the folder is not a git repository.
   */
  private async openRepository(): Promise<RepositoryInfo | null> {
    const window: BrowserWindow | null = this.windowGetter();
    if (window === null) {
      return null;
    }
    const result: OpenDialogReturnValue = await dialog.showOpenDialog(window, {
      properties: ['openDirectory'],
      title: 'Open Repository',
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return this.resolveRepository(result.filePaths[0]);
  }

  /**
   * Resolves the git repository root containing a folder and opens it. The folder is trusted only as a
   * starting point for `git rev-parse`; the resolved top level becomes the confined root.
   * @param directory The absolute folder path to resolve from.
   * @returns Returns the repository, or null when the folder is not inside a git repository.
   */
  private async resolveRepository(directory: unknown): Promise<RepositoryInfo | null> {
    if (typeof directory !== 'string' || directory.length === 0) {
      return null;
    }
    const start: string = path.resolve(directory);
    const result: GitRunResult = await this.run(start, ['rev-parse', '--show-toplevel']);
    if (!result.success || result.stdout === undefined) {
      return null;
    }
    const root: string = path.resolve(result.stdout.trim());
    if (root.length === 0) {
      return null;
    }
    this.roots.set(root, (this.roots.get(root) ?? 0) + 1);
    return { root, name: path.basename(root) };
  }

  /**
   * Releases an open repository root, decrementing its open count and removing it once the last
   * surface using it has released it.
   * @param root The absolute repository root to release.
   */
  private closeRepository(root: unknown): void {
    if (typeof root !== 'string') {
      return;
    }
    const resolved: string = path.resolve(root);
    const count: number | undefined = this.roots.get(resolved);
    if (count === undefined) {
      return;
    }
    if (count <= 1) {
      this.roots.delete(resolved);
    } else {
      this.roots.set(resolved, count - 1);
    }
  }

  /**
   * Reads the working-tree status (porcelain v2 with the branch header), null-delimited so paths with
   * spaces survive intact.
   * @param root The repository root.
   * @returns Returns the raw command result.
   */
  private status(root: unknown): Promise<GitRunResult> {
    return this.runInRoot(root, ['status', '--porcelain=v2', '--branch', '-z']);
  }

  /**
   * Reads the commit history with parents, author, dates, ref decorations, subject, and body. Fields
   * are separated by US (0x1f) and records by RS (0x1e) so they parse unambiguously.
   * @param root The repository root.
   * @param limit The maximum number of commits to read.
   * @returns Returns the raw command result.
   */
  private log(root: unknown, limit: unknown): Promise<GitRunResult> {
    const count: number =
      typeof limit === 'number' && Number.isFinite(limit)
        ? Math.min(MAX_LOG_LIMIT, Math.max(1, Math.floor(limit)))
        : MAX_LOG_LIMIT;
    const format: string = '%H%x1f%h%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%ar%x1f%D%x1f%s%x1f%b%x1e';
    return this.runInRoot(root, ['log', `--max-count=${count}`, `--format=${format}`]);
  }

  /**
   * Reads local branches, remote-tracking branches, and tags with their tips and upstream tracking.
   * @param root The repository root.
   * @returns Returns the raw command result.
   */
  private refs(root: unknown): Promise<GitRunResult> {
    const format: string =
      '%(refname)%1f%(objectname)%1f%(HEAD)%1f%(upstream:short)%1f%(upstream:track)';
    return this.runInRoot(root, [
      'for-each-ref',
      `--format=${format}`,
      'refs/heads',
      'refs/remotes',
      'refs/tags',
    ]);
  }

  /**
   * Reads the stash entries.
   * @param root The repository root.
   * @returns Returns the raw command result.
   */
  private stashes(root: unknown): Promise<GitRunResult> {
    return this.runInRoot(root, ['stash', 'list', '--format=%gd%1f%H%1f%s']);
  }

  /**
   * Reads the files changed by a single commit (name-status against its first parent), null-delimited.
   * @param root The repository root.
   * @param hash The commit hash to inspect.
   * @returns Returns the raw command result.
   */
  private commitFiles(root: unknown, hash: unknown): Promise<GitRunResult> {
    if (!isSafeOperand(hash)) {
      return Promise.resolve({ success: false, error: 'Invalid commit hash' });
    }
    return this.runInRoot(root, ['diff-tree', '--no-commit-id', '--name-status', '-r', '-z', hash]);
  }

  /**
   * Reads the contents of a file at a revision for one side of a diff. An empty revision reads the
   * working-tree file from disk (confined to the root); otherwise the file is read from the git object
   * at `revision:path`. A missing blob yields an empty string rather than an error, so an added or
   * deleted file simply has an empty side.
   * @param root The repository root.
   * @param revision The revision to read at, or an empty string for the working tree.
   * @param filePath The repository-relative file path.
   * @returns Returns the raw command result.
   */
  private async readBlob(
    root: unknown,
    revision: unknown,
    filePath: unknown,
  ): Promise<GitRunResult> {
    if (!this.isOpenRoot(root)) {
      return { success: false, error: 'Repository is not open' };
    }
    if (typeof filePath !== 'string' || filePath.length === 0 || filePath.startsWith('-')) {
      return { success: false, error: 'Invalid file path' };
    }
    const resolvedRoot: string = path.resolve(root);
    const absolute: string = path.resolve(resolvedRoot, filePath);
    if (absolute !== resolvedRoot && !absolute.startsWith(resolvedRoot + path.sep)) {
      return { success: false, error: 'Path escapes the repository' };
    }

    // Empty revision means the working tree: read the file from disk. A missing file is an empty side.
    if (revision === '') {
      try {
        const content: string = await readFile(absolute, 'utf8');
        return { success: true, stdout: content };
      } catch {
        return { success: true, stdout: '' };
      }
    }

    if (!isSafeOperand(revision)) {
      return { success: false, error: 'Invalid revision' };
    }
    const result: GitRunResult = await this.run(resolvedRoot, ['show', `${revision}:${filePath}`]);
    // A blob that does not exist at the revision (added or deleted file) is an empty side, not a failure.
    return result.success ? result : { success: true, stdout: '' };
  }

  /**
   * Stages files into the index, or the whole working tree when no paths are given.
   * @param root The repository root.
   * @param paths The repository-relative paths to stage, or an empty array to stage everything.
   * @returns Returns the raw command result.
   */
  private stage(root: unknown, paths: unknown): Promise<GitRunResult> {
    if (!this.isOpenRoot(root)) {
      return Promise.resolve({ success: false, error: 'Repository is not open' });
    }
    const confined: string[] | null = this.confinedPaths(path.resolve(root), paths);
    if (confined === null) {
      return Promise.resolve({ success: false, error: 'Invalid path' });
    }
    const args: string[] = confined.length === 0 ? ['add', '-A'] : ['add', '--', ...confined];
    return this.run(path.resolve(root), args);
  }

  /**
   * Unstages files from the index, or the whole index when no paths are given. The working tree is
   * left untouched.
   * @param root The repository root.
   * @param paths The repository-relative paths to unstage, or an empty array to unstage everything.
   * @returns Returns the raw command result.
   */
  private unstage(root: unknown, paths: unknown): Promise<GitRunResult> {
    if (!this.isOpenRoot(root)) {
      return Promise.resolve({ success: false, error: 'Repository is not open' });
    }
    const confined: string[] | null = this.confinedPaths(path.resolve(root), paths);
    if (confined === null) {
      return Promise.resolve({ success: false, error: 'Invalid path' });
    }
    const args: string[] =
      confined.length === 0 ? ['reset', '--quiet'] : ['reset', '--quiet', '--', ...confined];
    return this.run(path.resolve(root), args);
  }

  /**
   * Commits the staged changes with a message. The message is passed as a single argument, so it is
   * never interpreted as a shell command or git option.
   * @param root The repository root.
   * @param message The commit message.
   * @returns Returns the raw command result.
   */
  private commit(root: unknown, message: unknown): Promise<GitRunResult> {
    if (!this.isOpenRoot(root)) {
      return Promise.resolve({ success: false, error: 'Repository is not open' });
    }
    if (typeof message !== 'string' || message.trim().length === 0) {
      return Promise.resolve({ success: false, error: 'A commit message is required' });
    }
    return this.run(path.resolve(root), ['commit', '-m', message]);
  }

  /**
   * Stashes the tracked working-tree changes.
   * @param root The repository root.
   * @returns Returns the raw command result.
   */
  private stash(root: unknown): Promise<GitRunResult> {
    return this.runInRoot(root, ['stash', 'push']);
  }

  /**
   * Checks out an existing branch.
   * @param root The repository root.
   * @param branch The branch name.
   * @returns Returns the raw command result.
   */
  private checkout(root: unknown, branch: unknown): Promise<GitRunResult> {
    if (!isSafeOperand(branch)) {
      return Promise.resolve({ success: false, error: 'Invalid branch name' });
    }
    return this.runInRoot(root, ['checkout', branch]);
  }

  /**
   * Creates a branch at the current head and checks it out. Git validates the branch name and rejects
   * an invalid one.
   * @param root The repository root.
   * @param name The new branch name.
   * @returns Returns the raw command result.
   */
  private createBranch(root: unknown, name: unknown): Promise<GitRunResult> {
    if (!isSafeOperand(name)) {
      return Promise.resolve({ success: false, error: 'Invalid branch name' });
    }
    return this.runInRoot(root, ['checkout', '-b', name]);
  }

  /**
   * Fetches every remote, pruning remote-tracking branches that have been deleted upstream.
   * @param root The repository root.
   * @returns Returns the raw command result.
   */
  private fetch(root: unknown): Promise<GitRunResult> {
    return this.runNetwork(root, ['fetch', '--all', '--prune']);
  }

  /**
   * Pulls the current branch from its configured upstream. A merge conflict or a non-fast-forward
   * leaves git's message in stderr for the renderer to surface.
   * @param root The repository root.
   * @returns Returns the raw command result.
   */
  private pull(root: unknown): Promise<GitRunResult> {
    return this.runNetwork(root, ['pull']);
  }

  /**
   * Pushes the current branch. When a remote and branch are given (a branch with no upstream yet) the
   * upstream is set on the push; otherwise the configured upstream is used.
   * @param root The repository root.
   * @param remote The remote to set the upstream to, or undefined to push to the existing upstream.
   * @param branch The branch to set the upstream to, or undefined to push to the existing upstream.
   * @returns Returns the raw command result.
   */
  private push(root: unknown, remote: unknown, branch: unknown): Promise<GitRunResult> {
    if (remote === undefined && branch === undefined) {
      return this.runNetwork(root, ['push']);
    }
    if (!isSafeOperand(remote) || !isSafeOperand(branch)) {
      return Promise.resolve({ success: false, error: 'Invalid push upstream' });
    }
    return this.runNetwork(root, ['push', '--set-upstream', remote, branch]);
  }

  /**
   * Validates an array of repository-relative paths, rejecting non-strings, option-like values, and
   * any path that escapes the repository root.
   * @param resolvedRoot The resolved repository root.
   * @param paths The candidate paths.
   * @returns Returns the validated paths, or null when any path is invalid.
   */
  private confinedPaths(resolvedRoot: string, paths: unknown): string[] | null {
    if (!Array.isArray(paths)) {
      return null;
    }
    const confined: string[] = [];
    for (const candidate of paths) {
      if (typeof candidate !== 'string' || candidate.length === 0 || candidate.startsWith('-')) {
        return null;
      }
      const absolute: string = path.resolve(resolvedRoot, candidate);
      if (absolute !== resolvedRoot && !absolute.startsWith(resolvedRoot + path.sep)) {
        return null;
      }
      confined.push(candidate);
    }
    return confined;
  }

  /**
   * Runs git in an open repository root after validating the root is open.
   * @param root The repository root, which must be open.
   * @param args The fully-built git argument vector.
   * @returns Returns the raw command result.
   */
  private runInRoot(root: unknown, args: readonly string[]): Promise<GitRunResult> {
    if (!this.isOpenRoot(root)) {
      return Promise.resolve({ success: false, error: 'Repository is not open' });
    }
    return this.run(path.resolve(root), args);
  }

  /**
   * Runs a network git operation (fetch/pull/push) in an open root with a non-interactive environment
   * and a longer timeout, so it never blocks on a credential prompt and has time to reach the remote.
   * @param root The repository root, which must be open.
   * @param args The fully-built git argument vector.
   * @returns Returns the raw command result.
   */
  private runNetwork(root: unknown, args: readonly string[]): Promise<GitRunResult> {
    if (!this.isOpenRoot(root)) {
      return Promise.resolve({ success: false, error: 'Repository is not open' });
    }
    return this.run(path.resolve(root), args, {
      env: { ...process.env, ...GIT_NETWORK_ENV },
      timeoutMs: GIT_NETWORK_TIMEOUT_MS,
    });
  }

  /**
   * Determines whether a value is an open repository root.
   * @param root The value to test.
   * @returns Returns true when the value is a string naming an open root.
   */
  private isOpenRoot(root: unknown): root is string {
    return typeof root === 'string' && this.roots.has(path.resolve(root));
  }

  /**
   * Invokes git with array arguments in a working directory, capturing its output. The optional
   * environment overlay and timeout let network operations run non-interactively with a longer budget.
   * @param cwd The working directory to run in.
   * @param args The git argument vector.
   * @param options The optional environment and timeout overrides.
   * @returns Returns the raw command result.
   */
  private run(
    cwd: string,
    args: readonly string[],
    options?: { env?: NodeJS.ProcessEnv; timeoutMs?: number },
  ): Promise<GitRunResult> {
    return new Promise<GitRunResult>((resolve: (value: GitRunResult) => void): void => {
      execFile(
        'git',
        [...args],
        {
          cwd,
          timeout: options?.timeoutMs ?? GIT_TIMEOUT_MS,
          maxBuffer: GIT_MAX_BUFFER,
          windowsHide: true,
          ...(options?.env !== undefined ? { env: options.env } : {}),
        },
        (error: Error | null, stdout: string, stderr: string): void => {
          if (error !== null) {
            resolve({ success: false, error: error.message, stderr });
            return;
          }
          resolve({ success: true, stdout, stderr });
        },
      );
    });
  }
}
