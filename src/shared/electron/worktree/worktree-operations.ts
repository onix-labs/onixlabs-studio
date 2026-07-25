import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { STUDIO_DIR } from '@shared/api/studio';
import {
  addCheckoutEntry,
  defaultWorktreeConfig,
  isSafeCheckoutId,
  mintCheckoutId,
  parseWorktreeConfig,
  removeCheckoutEntry,
  serializeWorktreeConfig,
  WorkspaceKind,
  WorktreeCheckout,
  WorktreeCheckoutInfo,
  WorktreeCheckoutStatus,
  WorktreeConfig,
  WORKTREE_CONFIG_FILE,
  WorktreeDescriptor,
  worktreeError,
  worktreeOk,
  WorktreeOutcome,
} from '@shared/api/worktree';
import { TrustedPaths } from '../trusted-paths';
import { WorkspaceContext } from '../workspace-context';

/**
 * Holds the maximum time, in milliseconds, a local git invocation (branch/origin reads, checkout)
 * may run before being killed.
 */
const WORKTREE_GIT_TIMEOUT_MS: number = 20000;

/**
 * Holds the maximum time, in milliseconds, a clone may run. A checkout is a full clone that may
 * contact a remote, so it is given a far longer budget than the local-operation default.
 */
const WORKTREE_CLONE_TIMEOUT_MS: number = 600000;

/**
 * Holds the maximum size, in bytes, of a git invocation's captured output.
 */
const WORKTREE_GIT_MAX_BUFFER: number = 16 * 1024 * 1024;

/**
 * Holds the environment overlay applied to git invocations so they never block on an interactive
 * prompt — with no usable credentials a clone fails fast (and we surface its stderr) rather than
 * hanging until the timeout. Credentials still come from the user's configured git credential helper
 * and ssh-agent; this only disables interactive fallback.
 */
const WORKTREE_GIT_ENV: NodeJS.ProcessEnv = {
  GIT_TERMINAL_PROMPT: '0',
  GIT_SSH_COMMAND: 'ssh -o BatchMode=yes -o ConnectTimeout=10',
};

/**
 * The result of a git invocation: its trimmed stdout on success, or the most useful error text git
 * produced on failure.
 */
interface GitResult {
  /**
   * Gets whether the invocation succeeded.
   */
  readonly success: boolean;

  /**
   * Gets the trimmed standard output, when the invocation succeeded.
   */
  readonly stdout?: string;

  /**
   * Gets the failure text, when the invocation failed.
   */
  readonly error?: string;
}

/**
 * Validates a value passed to git as an operand (a branch name, a clone source) so the renderer
 * cannot smuggle options: a safe operand is a non-empty string that does not begin with a dash.
 * @param value The value to validate.
 * @returns Returns true when the value is safe to pass as a git operand.
 */
function isSafeOperand(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !value.startsWith('-');
}

/**
 * Implements the worktree-container disk operations: resolving what a directory is, describing a
 * container's live checkout state, promoting a repository workspace in place, and adding/removing
 * checkouts as independent full clones. Deliberately free of Electron imports so the mechanics are
 * unit-testable; the {@link import('./worktree-manager').WorktreeManager} wraps this behind IPC and
 * supplies the OS-trash function.
 *
 * Confinement treats the renderer as hostile, mirroring the workspace surfaces: kind resolution is
 * honoured only for trusted (previously dialog-opened) paths or paths within an open root, and every
 * container operation requires its root to be an open workspace root. Checkout ids are validated to
 * the exact UUID shape before ever being joined into a path.
 */
export class WorktreeOperations {
  /**
   * Holds the shared workspace context tracking the open roots.
   */
  private readonly workspace: WorkspaceContext;

  /**
   * Holds the trusted-paths store gating kind resolution for not-yet-open directories.
   */
  private readonly trusted: TrustedPaths;

  /**
   * Holds the function that sends a directory to the OS trash. Injected so removal is reversible in
   * production (Electron's trash) and observable in tests.
   */
  private readonly trash: (target: string) => Promise<void>;

  /**
   * Initializes a new instance of the {@link WorktreeOperations} class.
   * @param workspace The shared workspace context, used to confine every operation to open roots.
   * @param trusted The trusted-paths store, used to gate kind resolution.
   * @param trash The function that sends a directory to the OS trash.
   */
  public constructor(
    workspace: WorkspaceContext,
    trusted: TrustedPaths,
    trash: (target: string) => Promise<void>,
  ) {
    this.workspace = workspace;
    this.trusted = trusted;
    this.trash = trash;
  }

  /**
   * Resolves what a directory is: a worktree container (its `.studio/worktree.json` exists), a
   * workspace (a `.git` is present), or a plain folder. Container wins over repository so a
   * container is never mistaken for the repository its checkouts clone.
   * @param target The candidate directory path, honoured only when trusted or within an open root.
   * @returns Returns the kind, or null when the path is denied or not a directory.
   */
  public async resolveKind(target: unknown): Promise<WorkspaceKind | null> {
    if (typeof target !== 'string' || target.length === 0) {
      return null;
    }
    if (!this.trusted.has(target) && !this.workspace.isWithin(target)) {
      return null;
    }
    const root: string = path.resolve(target);
    if (!(await this.isDirectory(root))) {
      return null;
    }
    if (await this.exists(path.join(root, STUDIO_DIR, WORKTREE_CONFIG_FILE))) {
      return 'worktree';
    }
    if (await this.exists(path.join(root, '.git'))) {
      return 'workspace';
    }
    return 'folder';
  }

  /**
   * Describes an open container root: its origin and every registered checkout with its live state
   * (directory presence and current branch).
   * @param root The container root, which must be an open workspace root.
   * @returns Returns the descriptor, or null when the root is not open or not a container.
   */
  public async describe(root: unknown): Promise<WorktreeDescriptor | null> {
    if (typeof root !== 'string' || !this.workspace.isRoot(root)) {
      return null;
    }
    const resolved: string = path.resolve(root);
    const config: WorktreeConfig | null = await this.readConfig(resolved);
    if (config === null) {
      return null;
    }
    const checkouts: WorktreeCheckoutInfo[] = [];
    for (const checkout of config.checkouts) {
      checkouts.push(await this.describeCheckout(resolved, checkout));
    }
    return { root: resolved, origin: config.origin, checkouts };
  }

  /**
   * Promotes an open repository workspace, in place, into a worktree container: the entire prior
   * contents (including the repository's own committed `.studio`) move into a new GUID checkout
   * directory, and the container's `.studio/worktree.json` is seeded with that checkout and the
   * repository's origin. The root path itself is unchanged — it simply resolves as a container from
   * now on. A failed move is rolled back, so the workspace is never left half-promoted.
   * @param root The repository workspace root, which must be an open workspace root.
   * @returns Returns the promoted container's descriptor, or the failure reason.
   */
  public async promote(root: unknown): Promise<WorktreeOutcome<WorktreeDescriptor>> {
    if (typeof root !== 'string' || !this.workspace.isRoot(root)) {
      return worktreeError('The workspace is not open.');
    }
    const resolved: string = path.resolve(root);
    if (await this.exists(path.join(resolved, STUDIO_DIR, WORKTREE_CONFIG_FILE))) {
      return worktreeError('The workspace is already a worktree container.');
    }
    if (!(await this.exists(path.join(resolved, '.git')))) {
      return worktreeError('The workspace is not a git repository.');
    }

    const id: string = mintCheckoutId();
    const target: string = path.join(resolved, id);
    let entries: readonly string[];
    try {
      entries = await fs.readdir(resolved);
      await fs.mkdir(target);
    } catch (error) {
      return worktreeError(`The workspace could not be prepared: ${this.message(error)}`);
    }

    const moved: string[] = [];
    for (const entry of entries) {
      try {
        await fs.rename(path.join(resolved, entry), path.join(target, entry));
        moved.push(entry);
      } catch (error) {
        await this.rollbackPromotion(resolved, target, moved);
        return worktreeError(`"${entry}" could not be moved: ${this.message(error)}`);
      }
    }

    const origin: string | null = await this.readOrigin(target);
    try {
      await this.writeConfig(resolved, defaultWorktreeConfig(origin, [{ id }]));
    } catch (error) {
      await this.rollbackPromotion(resolved, target, moved);
      return worktreeError(
        `The container configuration could not be written: ${this.message(error)}`,
      );
    }

    const descriptor: WorktreeDescriptor | null = await this.describe(resolved);
    return descriptor === null
      ? worktreeError('The promoted container could not be described.')
      : worktreeOk(descriptor);
  }

  /**
   * Adds a checkout to an open container root: a new full clone of the container's origin — or of an
   * existing sibling checkout when the container is local-only (the sibling then serves as the
   * clone's origin remote) — optionally switched to a branch, created when it does not exist.
   * @param root The container root, which must be an open workspace root.
   * @param options The candidate branch and alias options, never trusted.
   * @returns Returns the new checkout's info, or the failure reason.
   */
  public async addCheckout(
    root: unknown,
    options: unknown,
  ): Promise<WorktreeOutcome<WorktreeCheckoutInfo>> {
    if (typeof root !== 'string' || !this.workspace.isRoot(root)) {
      return worktreeError('The workspace is not open.');
    }
    const resolved: string = path.resolve(root);
    const config: WorktreeConfig | null = await this.readConfig(resolved);
    if (config === null) {
      return worktreeError('The workspace is not a worktree container.');
    }
    const record: Record<string, unknown> =
      typeof options === 'object' && options !== null ? (options as Record<string, unknown>) : {};
    const branch: string | undefined = isSafeOperand(record['branch'])
      ? record['branch']
      : undefined;
    const alias: string | undefined =
      typeof record['alias'] === 'string' && record['alias'].length > 0
        ? record['alias']
        : undefined;

    const source: string | null =
      config.origin ?? (await this.firstExistingCheckout(resolved, config));
    if (source === null || !isSafeOperand(source)) {
      return worktreeError('The container has no origin and no existing checkout to clone from.');
    }

    // The Studio-level uniqueness guard: a branch already checked out by another checkout is
    // refused at creation (full clones mean git itself would not object). Drift after creation —
    // switching branches in a terminal — is reported by the panel's warnings, not prevented.
    if (branch !== undefined) {
      const taken: readonly WorktreeCheckoutStatus[] | null = await this.status(resolved);
      if (taken?.some((entry: WorktreeCheckoutStatus): boolean => entry.branch === branch)) {
        return worktreeError(`The branch "${branch}" is already checked out by another worktree.`);
      }
    }

    const id: string = mintCheckoutId();
    const clone: GitResult = await this.git(
      resolved,
      ['clone', '--', source, id],
      WORKTREE_CLONE_TIMEOUT_MS,
    );
    if (!clone.success) {
      return worktreeError(`The checkout could not be cloned: ${clone.error ?? 'unknown error'}`);
    }
    const directory: string = path.join(resolved, id);
    if (branch !== undefined) {
      const switched: GitResult = await this.git(directory, ['checkout', branch]);
      if (!switched.success) {
        const created: GitResult = await this.git(directory, ['checkout', '-b', branch]);
        if (!created.success) {
          return worktreeError(
            `The branch could not be checked out: ${created.error ?? 'unknown error'}`,
          );
        }
      }
    }

    try {
      await this.writeConfig(resolved, addCheckoutEntry(config, { id, alias }));
    } catch (error) {
      return worktreeError(
        `The container configuration could not be written: ${this.message(error)}`,
      );
    }
    return worktreeOk(await this.describeCheckout(resolved, { id, alias }));
  }

  /**
   * Registers a checkout's directory as an open workspace root, so the per-checkout view can use
   * every root-confined surface (studio persistence, git, watchers) exactly like an
   * ordinarily-opened workspace. Sound because the checkout lies within an already-open container
   * root the user chose; the renderer still cannot conjure roots elsewhere.
   * @param root The container root, which must be an open workspace root.
   * @param id The candidate checkout id, never trusted.
   * @returns Returns the checkout's absolute path, or the failure reason.
   */
  public async openCheckout(root: unknown, id: unknown): Promise<WorktreeOutcome<string>> {
    if (typeof root !== 'string' || !this.workspace.isRoot(root)) {
      return worktreeError('The workspace is not open.');
    }
    const resolved: string = path.resolve(root);
    const config: WorktreeConfig | null = await this.readConfig(resolved);
    if (config === null) {
      return worktreeError('The workspace is not a worktree container.');
    }
    if (
      !isSafeCheckoutId(id) ||
      !config.checkouts.some((entry: WorktreeCheckout): boolean => entry.id === id)
    ) {
      return worktreeError('The checkout is not registered in this container.');
    }
    const directory: string = path.join(resolved, id);
    if (!(await this.isDirectory(directory))) {
      return worktreeError('The checkout directory is missing.');
    }
    this.workspace.addRoot(directory);
    return worktreeOk(directory);
  }

  /**
   * Reads every registered checkout's lightweight status — branch, changed working-tree entries,
   * and ahead/behind relative to its upstream — for the Worktrees panel. A checkout whose state
   * cannot be read reports null fields rather than failing the whole read.
   * @param root The container root, which must be an open workspace root.
   * @returns Returns the statuses in registration order, or null when the root is not open or not
   * a container.
   */
  public async status(root: unknown): Promise<readonly WorktreeCheckoutStatus[] | null> {
    if (typeof root !== 'string' || !this.workspace.isRoot(root)) {
      return null;
    }
    const resolved: string = path.resolve(root);
    const config: WorktreeConfig | null = await this.readConfig(resolved);
    if (config === null) {
      return null;
    }
    const statuses: WorktreeCheckoutStatus[] = [];
    for (const checkout of config.checkouts) {
      statuses.push(await this.readStatus(resolved, checkout.id));
    }
    return statuses;
  }

  /**
   * Reads the repository's known branch names — local heads plus remote branches with their remote
   * prefix stripped, deduplicated and sorted — from the container's first existing checkout, for
   * the New Worktree branch picker.
   * @param root The container root, which must be an open workspace root.
   * @returns Returns the branch names, or null when the root is not open, not a container, or has
   * no existing checkout to read from.
   */
  public async branches(root: unknown): Promise<readonly string[] | null> {
    if (typeof root !== 'string' || !this.workspace.isRoot(root)) {
      return null;
    }
    const resolved: string = path.resolve(root);
    const config: WorktreeConfig | null = await this.readConfig(resolved);
    if (config === null) {
      return null;
    }
    const source: string | null = await this.firstExistingCheckout(resolved, config);
    if (source === null) {
      return null;
    }
    // Full refnames, not short ones: a LOCAL branch may itself contain slashes (feature/x), so only
    // the refs/heads/ vs refs/remotes/<remote>/ prefix can classify a name reliably.
    const result: GitResult = await this.git(source, [
      'for-each-ref',
      '--format=%(refname)',
      'refs/heads',
      'refs/remotes',
    ]);
    if (!result.success) {
      return null;
    }
    const names: Set<string> = new Set<string>();
    for (const line of (result.stdout ?? '').split('\n')) {
      const ref: string = line.trim();
      if (ref.startsWith('refs/heads/')) {
        names.add(ref.slice('refs/heads/'.length));
      } else if (ref.startsWith('refs/remotes/')) {
        const remote: string = ref.slice('refs/remotes/'.length);
        const separator: number = remote.indexOf('/');
        const name: string = separator === -1 ? '' : remote.slice(separator + 1);
        if (name.length > 0 && name !== 'HEAD') {
          names.add(name);
        }
      }
    }
    return [...names].sort((a: string, b: string): number => a.localeCompare(b));
  }

  /**
   * Reads one checkout's lightweight status.
   * @param root The resolved container root.
   * @param id The registered checkout id.
   * @returns Returns the status, with null fields for whatever cannot be read.
   */
  private async readStatus(root: string, id: string): Promise<WorktreeCheckoutStatus> {
    const directory: string = path.join(root, id);
    if (!(await this.isDirectory(directory))) {
      return { id, branch: null, changes: null, ahead: null, behind: null };
    }
    const branch: string | null = await this.readBranch(directory);
    const porcelain: GitResult = await this.git(directory, ['status', '--porcelain']);
    const changes: number | null = porcelain.success
      ? (porcelain.stdout ?? '').split('\n').filter((line: string): boolean => line.length > 0)
          .length
      : null;
    // `--left-right --count upstream...HEAD` prints "<behind>\t<ahead>": the left column counts
    // commits only in the upstream, the right column commits only in HEAD. No upstream fails the
    // command, which reads as "no counts" rather than zero.
    const counts: GitResult = await this.git(directory, [
      'rev-list',
      '--left-right',
      '--count',
      '@{upstream}...HEAD',
    ]);
    let ahead: number | null = null;
    let behind: number | null = null;
    if (counts.success) {
      const parts: readonly string[] = (counts.stdout ?? '').split(/\s+/);
      const left: number = Number.parseInt(parts[0] ?? '', 10);
      const right: number = Number.parseInt(parts[1] ?? '', 10);
      behind = Number.isNaN(left) ? null : left;
      ahead = Number.isNaN(right) ? null : right;
    }
    return { id, branch, changes, ahead, behind };
  }

  /**
   * Removes a registered checkout from an open container root: its directory goes to the OS trash
   * (never an unrecoverable delete) and the registry is updated. Removal is always explicit — there
   * is no automatic pruning.
   * @param root The container root, which must be an open workspace root.
   * @param id The candidate checkout id, never trusted.
   * @returns Returns a null value on success, or the failure reason.
   */
  public async removeCheckout(root: unknown, id: unknown): Promise<WorktreeOutcome<null>> {
    if (typeof root !== 'string' || !this.workspace.isRoot(root)) {
      return worktreeError('The workspace is not open.');
    }
    const resolved: string = path.resolve(root);
    const config: WorktreeConfig | null = await this.readConfig(resolved);
    if (config === null) {
      return worktreeError('The workspace is not a worktree container.');
    }
    if (
      !isSafeCheckoutId(id) ||
      !config.checkouts.some((entry: WorktreeCheckout): boolean => entry.id === id)
    ) {
      return worktreeError('The checkout is not registered in this container.');
    }
    const directory: string = path.join(resolved, id);
    if (await this.exists(directory)) {
      try {
        await this.trash(directory);
      } catch (error) {
        return worktreeError(
          `The checkout could not be moved to the trash: ${this.message(error)}`,
        );
      }
    }
    try {
      await this.writeConfig(resolved, removeCheckoutEntry(config, id));
    } catch (error) {
      return worktreeError(
        `The container configuration could not be written: ${this.message(error)}`,
      );
    }
    return worktreeOk(null);
  }

  /**
   * Describes one registered checkout's live state.
   * @param root The resolved container root.
   * @param checkout The registered checkout.
   * @returns Returns the checkout info.
   */
  private async describeCheckout(
    root: string,
    checkout: WorktreeCheckout,
  ): Promise<WorktreeCheckoutInfo> {
    const directory: string = path.join(root, checkout.id);
    const exists: boolean = await this.isDirectory(directory);
    const branch: string | null = exists ? await this.readBranch(directory) : null;
    return { id: checkout.id, alias: checkout.alias, path: directory, exists, branch };
  }

  /**
   * Finds the first registered checkout whose directory exists, used as the clone source for a
   * local-only container.
   * @param root The resolved container root.
   * @param config The container configuration.
   * @returns Returns the checkout's absolute path, or null when none exists.
   */
  private async firstExistingCheckout(
    root: string,
    config: WorktreeConfig,
  ): Promise<string | null> {
    for (const checkout of config.checkouts) {
      const directory: string = path.join(root, checkout.id);
      if (await this.isDirectory(directory)) {
        return directory;
      }
    }
    return null;
  }

  /**
   * Restores a failed promotion: every moved entry is renamed back to the root and the checkout
   * directory is removed. Restoration is best-effort — an entry that cannot move back is left for
   * the user rather than compounding the failure.
   * @param root The resolved container root.
   * @param target The checkout directory entries were moved into.
   * @param moved The entry names that were moved.
   */
  private async rollbackPromotion(
    root: string,
    target: string,
    moved: readonly string[],
  ): Promise<void> {
    for (const entry of moved) {
      try {
        await fs.rename(path.join(target, entry), path.join(root, entry));
      } catch {
        // Best-effort: leave what cannot be restored.
      }
    }
    try {
      await fs.rmdir(target);
    } catch {
      // Best-effort: an emptied directory that cannot be removed is harmless.
    }
  }

  /**
   * Reads a container's configuration, or null when the configuration file does not exist (the root
   * is not a container). A present-but-malformed file parses defensively to an empty container, so a
   * damaged registry degrades rather than hiding the container entirely.
   * @param root The resolved container root.
   * @returns Returns the configuration, or null.
   */
  private async readConfig(root: string): Promise<WorktreeConfig | null> {
    const file: string = path.join(root, STUDIO_DIR, WORKTREE_CONFIG_FILE);
    let contents: string;
    try {
      contents = await fs.readFile(file, 'utf8');
    } catch {
      return null;
    }
    try {
      return parseWorktreeConfig(JSON.parse(contents));
    } catch {
      return parseWorktreeConfig(null);
    }
  }

  /**
   * Atomically writes a container's configuration: the `.studio` directory is created when missing,
   * and the file is written to a temporary sibling then renamed so a reader never sees a partial
   * file.
   * @param root The resolved container root.
   * @param config The configuration to write.
   */
  private async writeConfig(root: string, config: WorktreeConfig): Promise<void> {
    const directory: string = path.join(root, STUDIO_DIR);
    await fs.mkdir(directory, { recursive: true });
    const target: string = path.join(directory, WORKTREE_CONFIG_FILE);
    const temporary: string = `${target}.${process.pid}.tmp`;
    await fs.writeFile(temporary, serializeWorktreeConfig(config), 'utf8');
    await fs.rename(temporary, target);
  }

  /**
   * Reads a repository's origin URL, or null when it has none (a local-only repository).
   * @param directory The repository directory.
   * @returns Returns the origin URL, or null.
   */
  private async readOrigin(directory: string): Promise<string | null> {
    const result: GitResult = await this.git(directory, ['remote', 'get-url', 'origin']);
    const origin: string = result.success ? (result.stdout ?? '') : '';
    return origin.length > 0 ? origin : null;
  }

  /**
   * Reads a repository's current branch, or null when it cannot be read.
   * @param directory The repository directory.
   * @returns Returns the branch name (or `HEAD` when detached), or null.
   */
  private async readBranch(directory: string): Promise<string | null> {
    const result: GitResult = await this.git(directory, ['rev-parse', '--abbrev-ref', 'HEAD']);
    const branch: string = result.success ? (result.stdout ?? '') : '';
    return branch.length > 0 ? branch : null;
  }

  /**
   * Invokes git with array arguments (never a shell) in a working directory, non-interactively.
   * @param cwd The working directory to run in.
   * @param args The git argument vector.
   * @param timeoutMs The maximum run time, defaulting to the local-operation budget.
   * @returns Returns the result.
   */
  private git(
    cwd: string,
    args: readonly string[],
    timeoutMs: number = WORKTREE_GIT_TIMEOUT_MS,
  ): Promise<GitResult> {
    return new Promise<GitResult>((resolve: (value: GitResult) => void): void => {
      execFile(
        'git',
        [...args],
        {
          cwd,
          timeout: timeoutMs,
          maxBuffer: WORKTREE_GIT_MAX_BUFFER,
          windowsHide: true,
          env: { ...process.env, ...WORKTREE_GIT_ENV, GIT_OPTIONAL_LOCKS: '0' },
        },
        (error: Error | null, stdout: string, stderr: string): void => {
          if (error !== null) {
            const detail: string = stderr.trim();
            resolve({ success: false, error: detail.length > 0 ? detail : error.message });
            return;
          }
          resolve({ success: true, stdout: stdout.trim() });
        },
      );
    });
  }

  /**
   * Extracts a readable message from a thrown value.
   * @param error The thrown value.
   * @returns Returns the message.
   */
  private message(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  /**
   * Determines whether a path exists.
   * @param target The path to test.
   * @returns Returns true when the path exists.
   */
  private async exists(target: string): Promise<boolean> {
    try {
      await fs.stat(target);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Determines whether a path exists and is a directory.
   * @param target The path to test.
   * @returns Returns true when the path is a directory.
   */
  private async isDirectory(target: string): Promise<boolean> {
    try {
      return (await fs.stat(target)).isDirectory();
    } catch {
      return false;
    }
  }
}
