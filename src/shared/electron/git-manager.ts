import { execFile } from 'node:child_process';
import { readFile, rm, stat } from 'node:fs/promises';
import * as path from 'node:path';
import {
  BrowserWindow,
  ipcMain,
  IpcMainInvokeEvent,
  OpenDialogReturnValue,
  WebContents,
} from 'electron';
import { showOpenDialog } from './dialog-parent';
import { logger } from './logger';
import {
  GitOperationState,
  GitRunResult,
  RepositoryInfo,
  SourceControlChannel,
  SourceControlCode,
} from '../api/source-control-channels';

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
 * Holds the maximum time, in milliseconds, a merge or rebase may run. Local work, but not necessarily
 * quick work: a merge across a large tree, or a rebase replaying dozens of commits, does real work per
 * file and per commit, and being killed part-way through would leave exactly the half-finished state
 * these operations are hard enough to reason about without.
 */
const GIT_INTEGRATION_TIMEOUT_MS: number = 120000;

/**
 * What a continue, skip, or abort says when the working tree is in the middle of nothing at all.
 */
const NO_OPERATION_ERROR: string = 'There is no operation in progress.';

/**
 * Holds the environment overlay applied to merges, rebases, and the commands that finish them.
 *
 * Every one of these opens an editor by default — `merge` for the merge message, `rebase --continue`
 * for the commit it is finishing, `rebase -i` for its todo list. Under `execFile` there is no terminal
 * for an editor to run in, so git would block until the timeout killed it, and the kill would land
 * mid-operation. Pointing all three editor hooks at `true` (the command that exits successfully
 * having done nothing) makes git accept the message it prepared and carry on.
 */
const GIT_NO_EDITOR_ENV: NodeJS.ProcessEnv = {
  GIT_EDITOR: 'true',
  GIT_SEQUENCE_EDITOR: 'true',
  GIT_MERGE_AUTOEDIT: 'no',
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
 * The revision naming the index (the staged content), as the renderer spells it.
 */
export const INDEX_REVISION: string = ':';

/**
 * Builds the `git show` argument naming one file at one revision.
 *
 * Git spells a blob as `<revision>:<path>` — and the index is the revision with no name at all, so
 * its blob is `:path`. The renderer names that revision `:`, which means the separator is already
 * there and must not be written twice: joining them naively produces `::path`, which git rejects as
 * an ambiguous argument.
 *
 * That was worth a bug. The rejection was indistinguishable from a blob that legitimately does not
 * exist at a revision, which {@link GitManager.readBlob} reports as an empty side — so every
 * working-tree diff quietly lost the side that came from the index. An unstaged file read as though
 * every line had just been added; a staged one as though every line had been deleted.
 *
 * @param revision The revision to read at.
 * @param filePath The repository-relative file path.
 * @returns Returns the argument to pass to `git show`.
 */
export function blobSpec(revision: string, filePath: string): string {
  return revision === INDEX_REVISION ? `${INDEX_REVISION}${filePath}` : `${revision}:${filePath}`;
}

/**
 * Holds the state files git writes into a repository's git directory while a multi-step operation is
 * unfinished, read together so one look says which operation is in flight and how far through it is.
 *
 * Presence is what matters for the first six; the rest carry the detail, and are null when git wrote
 * no such file. Kept as plain data so {@link classifyOperation} can be a pure function with a test —
 * the reading is trivial, the *rules* are not.
 */
export interface OperationProbe {
  /**
   * Gets a value indicating whether the `rebase-merge` directory exists (the rebase backend used for
   * interactive rebases and, since git 2.26, ordinary ones).
   */
  readonly rebaseMerge: boolean;

  /**
   * Gets a value indicating whether the `rebase-apply` directory exists (the older patch-applying
   * rebase backend, and the one `git am` uses).
   */
  readonly rebaseApply: boolean;

  /**
   * Gets a value indicating whether `MERGE_HEAD` exists — the commit being merged in.
   */
  readonly mergeHead: boolean;

  /**
   * Gets a value indicating whether `CHERRY_PICK_HEAD` exists.
   */
  readonly cherryPickHead: boolean;

  /**
   * Gets a value indicating whether `REVERT_HEAD` exists.
   */
  readonly revertHead: boolean;

  /**
   * Gets a value indicating whether `SQUASH_MSG` exists — written by a squash merge, which records no
   * `MERGE_HEAD` and so cannot be recognised any other way.
   */
  readonly squashMessage: boolean;

  /**
   * Gets the contents of the rebase's `head-name` (the full ref of the branch being replayed).
   */
  readonly headName: string | null;

  /**
   * Gets the contents of the rebase's `onto_name` (the ref the replay is onto, as the user named it).
   * Frequently absent: git writes it on some rebase paths and not others, which is why a rebase with
   * no name here has the commit it recorded resolved into one instead.
   */
  readonly ontoName: string | null;

  /**
   * Gets the contents of the rebase's `msgnum`/`next` (the commit being applied).
   */
  readonly step: string | null;

  /**
   * Gets the contents of the rebase's `end`/`last` (how many commits are to be applied).
   */
  readonly total: string | null;

  /**
   * Gets the first line of `MERGE_MSG`, which names what is being merged in the way a human would.
   */
  readonly mergeMessage: string | null;
}

/**
 * Strips the `refs/heads/` prefix from a ref, leaving a branch name as a user reads it.
 * @param ref The ref, or null.
 * @returns Returns the short name, or undefined when there was no ref.
 */
function shortBranchName(ref: string | null): string | undefined {
  if (ref === null || ref.length === 0) {
    return undefined;
  }
  const prefix: string = 'refs/heads/';
  return ref.startsWith(prefix) ? ref.slice(prefix.length) : ref;
}

/**
 * Pulls the quoted ref out of a merge message's first line — `Merge branch 'topic'` yields `topic`.
 *
 * Git's own generated message is the only place a plain merge records what it is merging under a name
 * rather than a hash, so it is worth reading; but it is prose, and prose is not a contract. A line
 * that does not match simply yields nothing, and the caller shows the operation without a target.
 *
 * @param message The merge message's first line, or null.
 * @returns Returns the quoted ref, or undefined when the line names none.
 */
function mergeTargetName(message: string | null): string | undefined {
  if (message === null) {
    return undefined;
  }
  const match: RegExpMatchArray | null = /'([^']+)'/.exec(message);
  return match === null ? undefined : match[1];
}

/**
 * Parses one of git's small counter files into a positive integer.
 * @param value The file's contents, or null.
 * @returns Returns the number, or undefined when there was none to read.
 */
function counter(value: string | null): number | undefined {
  if (value === null) {
    return undefined;
  }
  const parsed: number = Number.parseInt(value.trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * Decides which multi-step operation a repository is in the middle of from the state files git left.
 *
 * The order is the point. A rebase applying a commit that conflicts leaves `REBASE_HEAD` *and*, on
 * some paths, the same marker files a cherry-pick would — because replaying a commit is what a rebase
 * does — so the rebase directories are tested first and win. Squash is tested last, because it is
 * recognised only by the absence of everything else plus a `SQUASH_MSG`, and a plain merge that has
 * written its message would otherwise be mistaken for one.
 *
 * @param probe The state files read from the repository's git directory.
 * @returns Returns the operation state, whose kind is null when nothing is in flight.
 */
export function classifyOperation(probe: OperationProbe): GitOperationState {
  if (probe.rebaseMerge || probe.rebaseApply) {
    return {
      kind: 'rebase',
      ...(shortBranchName(probe.headName) === undefined
        ? {}
        : { branch: shortBranchName(probe.headName) }),
      ...(shortBranchName(probe.ontoName) === undefined
        ? {}
        : { target: shortBranchName(probe.ontoName) }),
      ...(counter(probe.step) === undefined ? {} : { step: counter(probe.step) }),
      ...(counter(probe.total) === undefined ? {} : { total: counter(probe.total) }),
    };
  }
  if (probe.cherryPickHead) {
    return { kind: 'cherry-pick' };
  }
  if (probe.revertHead) {
    return { kind: 'revert' };
  }
  const target: string | undefined = mergeTargetName(probe.mergeMessage);
  if (probe.mergeHead) {
    return { kind: 'merge', ...(target === undefined ? {} : { target }) };
  }
  if (probe.squashMessage) {
    return { kind: 'squash-merge', ...(target === undefined ? {} : { target }) };
  }
  return { kind: null };
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
   * Holds the accessor for the main application window, the dialog parent of last resort when the
   * requesting window is gone.
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
   * Holds the in-flight read commands, keyed by working directory and argument vector, so identical
   * concurrent reads share one git process.
   */
  private readonly inFlightReads: Map<string, Promise<GitRunResult>> = new Map<
    string,
    Promise<GitRunResult>
  >();

  /**
   * Initialises a new instance of the {@link GitManager} class.
   * @param windowGetter Returns the window dialogs are parented to when the requesting window is
   * gone, or null when none is open.
   */
  public constructor(windowGetter: () => BrowserWindow | null) {
    this.windowGetter = windowGetter;
  }

  /**
   * Registers the source-control IPC handlers.
   */
  public register(): void {
    logger.info('GitManager', 'Registering source-control IPC handlers');
    ipcMain.handle(
      SourceControlChannel.OpenRepository,
      (event: IpcMainInvokeEvent): Promise<RepositoryInfo | null> =>
        this.openRepository(event.sender),
    );
    ipcMain.handle(
      SourceControlChannel.ResolveRepository,
      (_event: IpcMainInvokeEvent, directory: unknown): Promise<RepositoryInfo | null> =>
        this.resolveRepository(directory),
    );
    ipcMain.handle(
      SourceControlChannel.CloseRepository,
      (_event: IpcMainInvokeEvent, root: unknown): void => this.closeRepository(root),
    );
    ipcMain.handle(
      SourceControlChannel.Status,
      (_event: IpcMainInvokeEvent, root: unknown): Promise<GitRunResult> => this.status(root),
    );
    ipcMain.handle(
      SourceControlChannel.OperationState,
      (_event: IpcMainInvokeEvent, root: unknown): Promise<GitOperationState> =>
        this.operationState(root),
    );
    ipcMain.handle(
      SourceControlChannel.Log,
      (_event: IpcMainInvokeEvent, root: unknown, limit: unknown): Promise<GitRunResult> =>
        this.log(root, limit),
    );
    ipcMain.handle(
      SourceControlChannel.Refs,
      (_event: IpcMainInvokeEvent, root: unknown): Promise<GitRunResult> => this.refs(root),
    );
    ipcMain.handle(
      SourceControlChannel.Remotes,
      (_event: IpcMainInvokeEvent, root: unknown): Promise<GitRunResult> => this.remotes(root),
    );
    ipcMain.handle(
      SourceControlChannel.Stashes,
      (_event: IpcMainInvokeEvent, root: unknown): Promise<GitRunResult> => this.stashes(root),
    );
    ipcMain.handle(
      SourceControlChannel.CommitFiles,
      (_event: IpcMainInvokeEvent, root: unknown, hash: unknown): Promise<GitRunResult> =>
        this.commitFiles(root, hash),
    );
    ipcMain.handle(
      SourceControlChannel.ReadBlob,
      (
        _event: IpcMainInvokeEvent,
        root: unknown,
        revision: unknown,
        filePath: unknown,
      ): Promise<GitRunResult> => this.readBlob(root, revision, filePath),
    );
    ipcMain.handle(
      SourceControlChannel.Discard,
      (_event: IpcMainInvokeEvent, root: unknown, paths: unknown): Promise<GitRunResult> =>
        this.discard(root, paths),
    );
    ipcMain.handle(
      SourceControlChannel.Stage,
      (_event: IpcMainInvokeEvent, root: unknown, paths: unknown): Promise<GitRunResult> =>
        this.stage(root, paths),
    );
    ipcMain.handle(
      SourceControlChannel.Unstage,
      (_event: IpcMainInvokeEvent, root: unknown, paths: unknown): Promise<GitRunResult> =>
        this.unstage(root, paths),
    );
    ipcMain.handle(
      SourceControlChannel.Commit,
      (_event: IpcMainInvokeEvent, root: unknown, message: unknown): Promise<GitRunResult> =>
        this.commit(root, message),
    );
    ipcMain.handle(
      SourceControlChannel.Stash,
      (_event: IpcMainInvokeEvent, root: unknown): Promise<GitRunResult> => this.stash(root),
    );
    ipcMain.handle(
      SourceControlChannel.StashApply,
      (_event: IpcMainInvokeEvent, root: unknown, index: unknown): Promise<GitRunResult> =>
        this.stashCommand(root, 'apply', index),
    );
    ipcMain.handle(
      SourceControlChannel.StashPop,
      (_event: IpcMainInvokeEvent, root: unknown, index: unknown): Promise<GitRunResult> =>
        this.stashCommand(root, 'pop', index),
    );
    ipcMain.handle(
      SourceControlChannel.StashDrop,
      (_event: IpcMainInvokeEvent, root: unknown, index: unknown): Promise<GitRunResult> =>
        this.stashCommand(root, 'drop', index),
    );
    ipcMain.handle(
      SourceControlChannel.Checkout,
      (_event: IpcMainInvokeEvent, root: unknown, branch: unknown): Promise<GitRunResult> =>
        this.checkout(root, branch),
    );
    ipcMain.handle(
      SourceControlChannel.CreateBranch,
      (
        _event: IpcMainInvokeEvent,
        root: unknown,
        name: unknown,
        checkout: unknown,
      ): Promise<GitRunResult> => this.createBranch(root, name, checkout),
    );
    ipcMain.handle(
      SourceControlChannel.Fetch,
      (_event: IpcMainInvokeEvent, root: unknown): Promise<GitRunResult> => this.fetch(root),
    );
    ipcMain.handle(
      SourceControlChannel.FetchRef,
      (
        _event: IpcMainInvokeEvent,
        root: unknown,
        remote: unknown,
        sourceRef: unknown,
        localBranch: unknown,
      ): Promise<GitRunResult> => this.fetchRef(root, remote, sourceRef, localBranch),
    );
    ipcMain.handle(
      SourceControlChannel.Pull,
      (_event: IpcMainInvokeEvent, root: unknown): Promise<GitRunResult> => this.pull(root),
    );
    ipcMain.handle(
      SourceControlChannel.Push,
      (
        _event: IpcMainInvokeEvent,
        root: unknown,
        remote: unknown,
        branch: unknown,
        setUpstream: unknown,
      ): Promise<GitRunResult> => this.push(root, remote, branch, setUpstream),
    );
    ipcMain.handle(
      SourceControlChannel.DeleteBranch,
      (
        _event: IpcMainInvokeEvent,
        root: unknown,
        name: unknown,
        force: unknown,
      ): Promise<GitRunResult> => this.deleteBranch(root, name, force),
    );
    ipcMain.handle(
      SourceControlChannel.RenameBranch,
      (
        _event: IpcMainInvokeEvent,
        root: unknown,
        from: unknown,
        to: unknown,
      ): Promise<GitRunResult> => this.renameBranch(root, from, to),
    );
    ipcMain.handle(
      SourceControlChannel.SetUpstream,
      (
        _event: IpcMainInvokeEvent,
        root: unknown,
        branch: unknown,
        upstream: unknown,
      ): Promise<GitRunResult> => this.setUpstream(root, branch, upstream),
    );
    ipcMain.handle(
      SourceControlChannel.FetchRemote,
      (_event: IpcMainInvokeEvent, root: unknown, remote: unknown): Promise<GitRunResult> =>
        this.fetchRemote(root, remote),
    );
    ipcMain.handle(
      SourceControlChannel.PruneRemote,
      (_event: IpcMainInvokeEvent, root: unknown, remote: unknown): Promise<GitRunResult> =>
        this.pruneRemote(root, remote),
    );
    ipcMain.handle(
      SourceControlChannel.AddRemote,
      (
        _event: IpcMainInvokeEvent,
        root: unknown,
        name: unknown,
        url: unknown,
      ): Promise<GitRunResult> => this.addRemote(root, name, url),
    );
    ipcMain.handle(
      SourceControlChannel.RemoveRemote,
      (_event: IpcMainInvokeEvent, root: unknown, name: unknown): Promise<GitRunResult> =>
        this.removeRemote(root, name),
    );
    ipcMain.handle(
      SourceControlChannel.CheckoutTracking,
      (
        _event: IpcMainInvokeEvent,
        root: unknown,
        remoteBranch: unknown,
        localBranch: unknown,
      ): Promise<GitRunResult> => this.checkoutTracking(root, remoteBranch, localBranch),
    );
    ipcMain.handle(
      SourceControlChannel.Merge,
      (
        _event: IpcMainInvokeEvent,
        root: unknown,
        branch: unknown,
        mode: unknown,
      ): Promise<GitRunResult> => this.merge(root, branch, mode),
    );
    ipcMain.handle(
      SourceControlChannel.Rebase,
      (_event: IpcMainInvokeEvent, root: unknown, onto: unknown): Promise<GitRunResult> =>
        this.rebase(root, onto),
    );
    ipcMain.handle(
      SourceControlChannel.OperationContinue,
      (_event: IpcMainInvokeEvent, root: unknown): Promise<GitRunResult> =>
        this.continueOperation(root),
    );
    ipcMain.handle(
      SourceControlChannel.OperationSkip,
      (_event: IpcMainInvokeEvent, root: unknown): Promise<GitRunResult> =>
        this.skipOperation(root),
    );
    ipcMain.handle(
      SourceControlChannel.OperationAbort,
      (_event: IpcMainInvokeEvent, root: unknown): Promise<GitRunResult> =>
        this.abortOperation(root),
    );
    ipcMain.handle(
      SourceControlChannel.CreateTag,
      (
        _event: IpcMainInvokeEvent,
        root: unknown,
        name: unknown,
        commit: unknown,
        message: unknown,
      ): Promise<GitRunResult> => this.createTag(root, name, commit, message),
    );
    ipcMain.handle(
      SourceControlChannel.DeleteTag,
      (_event: IpcMainInvokeEvent, root: unknown, name: unknown): Promise<GitRunResult> =>
        this.deleteTag(root, name),
    );
    ipcMain.handle(
      SourceControlChannel.DeleteRemoteTag,
      (
        _event: IpcMainInvokeEvent,
        root: unknown,
        remote: unknown,
        name: unknown,
      ): Promise<GitRunResult> => this.deleteRemoteTag(root, remote, name),
    );
    ipcMain.handle(
      SourceControlChannel.PushTag,
      (
        _event: IpcMainInvokeEvent,
        root: unknown,
        remote: unknown,
        name: unknown,
      ): Promise<GitRunResult> => this.pushTag(root, remote, name),
    );
    ipcMain.handle(
      SourceControlChannel.PushAllTags,
      (_event: IpcMainInvokeEvent, root: unknown, remote: unknown): Promise<GitRunResult> =>
        this.pushAllTags(root, remote),
    );
  }

  /**
   * Shows an open-folder dialog and resolves the chosen folder's enclosing git repository root,
   * opening it for subsequent operations.
   * @param sender The web contents that requested the dialog.
   * @returns Returns the repository, or null when cancelled or the folder is not a git repository.
   */
  private async openRepository(sender: WebContents): Promise<RepositoryInfo | null> {
    logger.trace('GitManager.openRepository', 'Open-repository dialog requested');
    const result: OpenDialogReturnValue = await showOpenDialog(sender, this.windowGetter, {
      properties: ['openDirectory'],
      title: 'Open Repository',
    });
    if (result.canceled || result.filePaths.length === 0) {
      logger.trace('GitManager.openRepository', 'Open-repository dialog cancelled');
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
    logger.debug('GitManager.resolveRepository', `Resolving repository root from ${start}`);
    const result: GitRunResult = await this.run(start, ['rev-parse', '--show-toplevel']);
    if (!result.success || result.stdout === undefined) {
      logger.trace('GitManager.resolveRepository', `Not a git repository: ${start}`);
      return null;
    }
    const root: string = path.resolve(result.stdout.trim());
    if (root.length === 0) {
      return null;
    }
    const count: number = (this.roots.get(root) ?? 0) + 1;
    this.roots.set(root, count);
    logger.info('GitManager', `Opened repository ${root} (open count ${count})`);
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
      logger.trace('GitManager.closeRepository', `Close ignored, root not open: ${resolved}`);
      return;
    }
    if (count <= 1) {
      this.roots.delete(resolved);
      logger.info('GitManager', `Closed repository ${resolved}`);
    } else {
      this.roots.set(resolved, count - 1);
      logger.trace('GitManager.closeRepository', `Released ${resolved} (open count ${count - 1})`);
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
   * Reads the multi-step operation the repository is in the middle of, if any.
   *
   * The git directory is asked for rather than assumed: a linked worktree's `.git` is a *file*
   * pointing elsewhere, and its merge and rebase state lives in that worktree's own directory under
   * the main repository. Joining `.git` to the root would look in the wrong place for every worktree
   * the unified-workspace work made possible, and quietly report that nothing is in flight.
   *
   * @param root The repository root.
   * @returns Returns the operation state, whose kind is null when nothing is in flight.
   */
  private async operationState(root: unknown): Promise<GitOperationState> {
    if (!this.isOpenRoot(root)) {
      return { kind: null };
    }
    const located: GitRunResult = await this.runInRoot(root, ['rev-parse', '--absolute-git-dir']);
    const directory: string = (located.stdout ?? '').trim();
    if (!located.success || directory.length === 0) {
      return { kind: null };
    }
    const state: GitOperationState = classifyOperation(await this.probeOperation(directory));
    if (state.kind !== 'rebase' || state.target !== undefined) {
      return state;
    }
    // A rebase usually records only the commit it is replaying onto, not the name the user gave it —
    // `onto_name` is written by some paths and not others — so the commit is turned back into a
    // branch name here rather than shown as a hash nobody asked about.
    const target: string | undefined = await this.rebaseOntoName(root, directory);
    return target === undefined ? state : { ...state, target };
  }

  /**
   * Resolves the branch name a rebase in flight is replaying onto, from the commit it recorded.
   * @param root The repository root.
   * @param directory The absolute git directory.
   * @returns Returns the branch name, the abbreviated commit when it belongs to no branch, or
   * undefined when the rebase recorded nothing to resolve.
   */
  private async rebaseOntoName(root: unknown, directory: string): Promise<string | undefined> {
    const onto: string | null = await firstFile([
      path.join(directory, 'rebase-merge', 'onto'),
      path.join(directory, 'rebase-apply', 'onto'),
    ]);
    if (onto === null || !isSafeOperand(onto)) {
      return undefined;
    }
    const named: GitRunResult = await this.runInRoot(root, [
      'name-rev',
      '--name-only',
      '--refs=refs/heads/*',
      onto,
    ]);
    const name: string = (named.stdout ?? '').trim();
    // `name-rev` answers `undefined` for a commit no branch reaches, which is a name for nothing.
    return named.success && name.length > 0 && name !== 'undefined' ? name : onto.slice(0, 7);
  }

  /**
   * Reads the state files a multi-step operation leaves in a repository's git directory. Every read
   * is forgiving: a file that is not there is the ordinary case, and means the operation that writes
   * it is not running.
   * @param directory The absolute git directory.
   * @returns Returns the probe.
   */
  private async probeOperation(directory: string): Promise<OperationProbe> {
    const at: (...parts: readonly string[]) => string = (...parts: readonly string[]): string =>
      path.join(directory, ...parts);
    const [
      rebaseMerge,
      rebaseApply,
      mergeHead,
      cherryPickHead,
      revertHead,
      squashMessage,
      headName,
      ontoName,
      step,
      total,
      mergeMessage,
    ]: [
      boolean,
      boolean,
      boolean,
      boolean,
      boolean,
      boolean,
      string | null,
      string | null,
      string | null,
      string | null,
      string | null,
    ] = await Promise.all([
      exists(at('rebase-merge')),
      exists(at('rebase-apply')),
      exists(at('MERGE_HEAD')),
      exists(at('CHERRY_PICK_HEAD')),
      exists(at('REVERT_HEAD')),
      exists(at('SQUASH_MSG')),
      // The two rebase backends name the same facts differently, so each is read from whichever
      // directory is present; only one of the pair can exist at a time.
      firstFile([at('rebase-merge', 'head-name'), at('rebase-apply', 'head-name')]),
      // Only some rebases write a name here at all; {@link GitManager.rebaseOntoName} resolves the
      // recorded commit when they do not.
      firstFile([at('rebase-merge', 'onto_name')]),
      firstFile([at('rebase-merge', 'msgnum'), at('rebase-apply', 'next')]),
      firstFile([at('rebase-merge', 'end'), at('rebase-apply', 'last')]),
      firstLine(at('MERGE_MSG')),
    ]);
    return {
      rebaseMerge,
      rebaseApply,
      mergeHead,
      cherryPickHead,
      revertHead,
      squashMessage,
      headName,
      ontoName,
      step,
      total,
      mergeMessage,
    };
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
   * Reads the configured remotes with their URLs. Purely local configuration — no network is touched,
   * so this runs on the ordinary timeout rather than the network one.
   * @param root The repository root.
   * @returns Returns the raw command result.
   */
  private remotes(root: unknown): Promise<GitRunResult> {
    return this.runInRoot(root, ['remote', '-v']);
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
   * Reads the contents of a file at a revision for one side of a diff.
   *
   * Three kinds of revision arrive here. An empty string is the working tree, read from disk and
   * confined to the root. {@link INDEX_REVISION} is the staged content. Anything else is a real
   * revision, and the blob is read from the git object at `revision:path` — see {@link blobSpec} for
   * why those last two cannot be joined the same way.
   *
   * A missing blob yields an empty string rather than an error, so an added or deleted file simply
   * has an empty side. That forgiveness is deliberate but it is also blind: it cannot tell a blob
   * that is absent from an argument git could not parse, which is why the spec is built by a function
   * that has a test rather than inline here.
   *
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
    const result: GitRunResult = await this.run(resolvedRoot, [
      'show',
      blobSpec(revision, filePath),
    ]);
    // A blob that does not exist at the revision (added or deleted file) is an empty side, not a failure.
    return result.success ? result : { success: true, stdout: '' };
  }

  /**
   * Discards the uncommitted changes to files — destructive, so the split between restore and
   * delete is decided here from git's own view of the index, never trusted from the renderer:
   * paths git tracks are restored to `HEAD` (index and working tree), and paths git reports as
   * untracked (and not ignored) are deleted from disk. A path that is neither — for example an
   * ignored file — is left untouched.
   * @param root The repository root.
   * @param paths The repository-relative paths to discard; must not be empty.
   * @returns Returns the raw command result.
   */
  private async discard(root: unknown, paths: unknown): Promise<GitRunResult> {
    if (!this.isOpenRoot(root)) {
      return { success: false, error: 'Repository is not open' };
    }
    const resolvedRoot: string = path.resolve(root);
    const confined: string[] | null = this.confinedPaths(resolvedRoot, paths);
    if (confined === null || confined.length === 0) {
      return { success: false, error: 'Invalid path' };
    }
    logger.trace('GitManager.discard', `Discarding ${confined.length} path(s) in ${resolvedRoot}`);
    const tracked: Set<string> = await this.listedPaths(resolvedRoot, ['ls-files'], confined);
    const untracked: Set<string> = await this.listedPaths(
      resolvedRoot,
      ['ls-files', '--others', '--exclude-standard'],
      confined,
    );
    const toRestore: string[] = confined.filter((candidate: string): boolean =>
      tracked.has(candidate),
    );
    // An untracked directory is discarded by deleting it; ls-files lists the files inside it, so a
    // candidate counts as untracked when it is listed itself or is a listed file's ancestor.
    const toDelete: string[] = confined.filter(
      (candidate: string): boolean =>
        !tracked.has(candidate) &&
        [...untracked].some(
          (listed: string): boolean => listed === candidate || listed.startsWith(`${candidate}/`),
        ),
    );
    logger.debug(
      'GitManager.discard',
      `Discard plan: restore ${toRestore.length}, delete ${toDelete.length}`,
    );
    for (const relative of toDelete) {
      try {
        await rm(path.resolve(resolvedRoot, relative), { recursive: true, force: true });
      } catch (error: unknown) {
        logger.error('GitManager', `Failed to delete ${relative} while discarding changes`, error);
        return { success: false, error: `Failed to delete ${relative}: ${String(error)}` };
      }
    }
    if (toRestore.length > 0) {
      return this.run(resolvedRoot, ['restore', '--staged', '--worktree', '--', ...toRestore]);
    }
    return { success: true, stdout: '' };
  }

  /**
   * Lists the confined paths a git listing command reports, as a set of repository-relative paths.
   * @param resolvedRoot The resolved repository root.
   * @param listing The git listing command (an `ls-files` variant).
   * @param confined The already-confined candidate paths to scope the listing to.
   * @returns Returns the listed paths.
   */
  private async listedPaths(
    resolvedRoot: string,
    listing: readonly string[],
    confined: readonly string[],
  ): Promise<Set<string>> {
    const result: GitRunResult = await this.run(resolvedRoot, [...listing, '--', ...confined]);
    if (!result.success || result.stdout === undefined) {
      return new Set<string>();
    }
    return new Set<string>(
      result.stdout.split('\n').filter((line: string): boolean => line.length > 0),
    );
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
    logger.trace(
      'GitManager.stage',
      confined.length === 0 ? 'Staging all changes' : `Staging ${confined.length} path(s)`,
    );
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
    logger.trace(
      'GitManager.unstage',
      confined.length === 0 ? 'Unstaging all changes' : `Unstaging ${confined.length} path(s)`,
    );
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
    logger.trace('GitManager.commit', `Committing staged changes in ${path.resolve(root)}`);
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
   * Runs a stash-stack command against one entry. The stash is addressed by its stack index rather
   * than by a caller-supplied selector, so the operand is built here from a validated number and no
   * renderer string ever reaches the git command line.
   * @param root The repository root.
   * @param command The stash subcommand to run.
   * @param index The stack index of the stash (0 is the most recent).
   * @returns Returns the raw command result.
   */
  private stashCommand(
    root: unknown,
    command: 'apply' | 'pop' | 'drop',
    index: unknown,
  ): Promise<GitRunResult> {
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0) {
      return Promise.resolve({ success: false, error: 'Invalid stash index' });
    }
    return this.runInRoot(root, ['stash', command, `stash@{${index}}`]);
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
    logger.trace('GitManager.checkout', `Checking out branch ${branch}`);
    return this.runInRoot(root, ['checkout', branch]);
  }

  /**
   * Creates a branch at the current head, checking it out when asked. Git validates the branch name
   * and rejects an invalid one.
   * @param root The repository root.
   * @param name The new branch name.
   * @param checkout Whether to check the new branch out.
   * @returns Returns the raw command result.
   */
  private createBranch(root: unknown, name: unknown, checkout: unknown): Promise<GitRunResult> {
    if (!isSafeOperand(name)) {
      return Promise.resolve({ success: false, error: 'Invalid branch name' });
    }
    // `checkout -b` creates and switches; `branch` creates and leaves the current branch checked out.
    logger.trace(
      'GitManager.createBranch',
      `Creating branch ${name}${checkout === false ? '' : ' and checking it out'}`,
    );
    return checkout === false
      ? this.runInRoot(root, ['branch', name])
      : this.runInRoot(root, ['checkout', '-b', name]);
  }

  /**
   * Fetches every remote, pruning remote-tracking branches that have been deleted upstream.
   * @param root The repository root.
   * @returns Returns the raw command result.
   */
  private fetch(root: unknown): Promise<GitRunResult> {
    logger.trace('GitManager.fetch', 'Fetching all remotes with prune');
    return this.runNetwork(root, ['fetch', '--all', '--prune']);
  }

  /**
   * Deletes a local branch. Destructive; the caller confirms first.
   *
   * An unforced delete that git refuses is classified here rather than left to the renderer to read
   * out of the error text. Git declines when a branch holds commits merged neither into HEAD nor into
   * its upstream, and that is the one refusal the user is offered a way past — so it is worth knowing
   * for certain rather than by matching an English sentence that is not a contract.
   *
   * The check is made in two steps because they answer different questions: whether the branch is
   * still there at all, and only then whether it is an ancestor of HEAD. Skipping the first would let
   * a delete of something already gone be reported as unmerged, and offer to force what does not
   * exist.
   *
   * @param root The repository root.
   * @param name The branch name.
   * @param force Whether to delete a branch whose commits are not merged anywhere.
   * @returns Returns the raw command result.
   */
  private async deleteBranch(root: unknown, name: unknown, force: unknown): Promise<GitRunResult> {
    if (!isSafeOperand(name)) {
      return { success: false, error: 'Invalid branch name' };
    }
    const forced: boolean = force === true;
    logger.trace('GitManager.deleteBranch', `Deleting branch ${name}${forced ? ' (forced)' : ''}`);
    const result: GitRunResult = await this.runInRoot(root, ['branch', forced ? '-D' : '-d', name]);
    if (result.success || forced) {
      return result;
    }
    const exists: GitRunResult = await this.runInRoot(root, [
      'rev-parse',
      '--verify',
      '--quiet',
      `refs/heads/${name}`,
    ]);
    if (!exists.success) {
      return result;
    }
    const merged: GitRunResult = await this.runInRoot(root, [
      'merge-base',
      '--is-ancestor',
      name,
      'HEAD',
    ]);
    return merged.success ? result : { ...result, code: SourceControlCode.BranchNotMerged };
  }

  /**
   * Renames a local branch, including the checked-out one.
   * @param root The repository root.
   * @param from The current branch name.
   * @param to The new branch name.
   * @returns Returns the raw command result.
   */
  private renameBranch(root: unknown, from: unknown, to: unknown): Promise<GitRunResult> {
    if (!isSafeOperand(from) || !isSafeOperand(to)) {
      return Promise.resolve({ success: false, error: 'Invalid branch name' });
    }
    logger.trace('GitManager.renameBranch', `Renaming branch ${from} to ${to}`);
    return this.runInRoot(root, ['branch', '-m', from, to]);
  }

  /**
   * Points a local branch's upstream at a remote-tracking branch, or clears it.
   *
   * The upstream travels inside `--set-upstream-to=`, so it is validated as an operand in its own
   * right before the flag is built around it — the flag is Studio's, but the value is the renderer's.
   *
   * @param root The repository root.
   * @param branch The local branch.
   * @param upstream The remote-tracking branch to track, or null to clear the upstream.
   * @returns Returns the raw command result.
   */
  private setUpstream(root: unknown, branch: unknown, upstream: unknown): Promise<GitRunResult> {
    if (!isSafeOperand(branch)) {
      return Promise.resolve({ success: false, error: 'Invalid branch name' });
    }
    if (upstream === null) {
      logger.trace('GitManager.setUpstream', `Clearing the upstream of ${branch}`);
      return this.runInRoot(root, ['branch', '--unset-upstream', branch]);
    }
    if (!isSafeOperand(upstream)) {
      return Promise.resolve({ success: false, error: 'Invalid upstream' });
    }
    logger.trace('GitManager.setUpstream', `Setting the upstream of ${branch} to ${upstream}`);
    return this.runInRoot(root, ['branch', `--set-upstream-to=${upstream}`, branch]);
  }

  /**
   * Fetches one remote, rather than all of them.
   * @param root The repository root.
   * @param remote The remote to fetch.
   * @returns Returns the raw command result.
   */
  private fetchRemote(root: unknown, remote: unknown): Promise<GitRunResult> {
    if (!isSafeOperand(remote)) {
      return Promise.resolve({ success: false, error: 'Invalid remote' });
    }
    logger.trace('GitManager.fetchRemote', `Fetching remote ${remote}`);
    return this.runNetwork(root, ['fetch', remote]);
  }

  /**
   * Prunes one remote's tracking branches that no longer exist on it.
   *
   * `remote prune` rather than `fetch --prune`, because pruning and fetching are separate answers to
   * separate questions: one asks what has been deleted upstream, the other asks what is new. Offering
   * them as one command would mean a user who wanted to tidy their branch list had to pull down
   * whatever else had landed to get it.
   *
   * @param root The repository root.
   * @param remote The remote to prune.
   * @returns Returns the raw command result.
   */
  private pruneRemote(root: unknown, remote: unknown): Promise<GitRunResult> {
    if (!isSafeOperand(remote)) {
      return Promise.resolve({ success: false, error: 'Invalid remote' });
    }
    logger.trace('GitManager.pruneRemote', `Pruning remote ${remote}`);
    return this.runNetwork(root, ['remote', 'prune', remote]);
  }

  /**
   * Adds a remote.
   *
   * The URL is held to {@link isSafeOperand} like any other operand, which also rejects the one shape
   * that would matter here: a URL beginning with a dash would be read by git as an option rather than
   * an address.
   *
   * @param root The repository root.
   * @param name The remote name.
   * @param url The remote URL.
   * @returns Returns the raw command result.
   */
  private addRemote(root: unknown, name: unknown, url: unknown): Promise<GitRunResult> {
    if (!isSafeOperand(name) || !isSafeOperand(url)) {
      return Promise.resolve({ success: false, error: 'Invalid remote name or URL' });
    }
    logger.trace('GitManager.addRemote', `Adding remote ${name}`);
    return this.runInRoot(root, ['remote', 'add', name, url]);
  }

  /**
   * Removes a remote, along with its tracking branches. Destructive; the caller confirms first.
   * @param root The repository root.
   * @param name The remote name.
   * @returns Returns the raw command result.
   */
  private removeRemote(root: unknown, name: unknown): Promise<GitRunResult> {
    if (!isSafeOperand(name)) {
      return Promise.resolve({ success: false, error: 'Invalid remote name' });
    }
    logger.trace('GitManager.removeRemote', `Removing remote ${name}`);
    return this.runInRoot(root, ['remote', 'remove', name]);
  }

  /**
   * Creates a local branch tracking a remote-tracking branch, and checks it out.
   *
   * Both operands are named rather than letting `--track` derive the local name, because what git
   * derives depends on configuration the panel cannot see, and a row that says it will check out
   * `main` should not produce something else.
   *
   * @param root The repository root.
   * @param remoteBranch The remote-tracking branch, as `origin/main`.
   * @param localBranch The local branch to create.
   * @returns Returns the raw command result.
   */
  private checkoutTracking(
    root: unknown,
    remoteBranch: unknown,
    localBranch: unknown,
  ): Promise<GitRunResult> {
    if (!isSafeOperand(remoteBranch) || !isSafeOperand(localBranch)) {
      return Promise.resolve({ success: false, error: 'Invalid branch name' });
    }
    logger.trace(
      'GitManager.checkoutTracking',
      `Checking out ${localBranch} tracking ${remoteBranch}`,
    );
    return this.runInRoot(root, ['checkout', '-b', localBranch, '--track', remoteBranch]);
  }

  /**
   * Fetches one ref from a remote into a local branch, as `git fetch <remote> <source>:<local>`.
   *
   * The refspec is built here from three validated operands rather than accepted whole from the
   * renderer: a colon inside any of them would let one argument become several refspecs, and a `+`
   * prefix would silently make the fetch a force-update over whatever the local branch held.
   *
   * @param root The repository root.
   * @param remote The remote to fetch from.
   * @param sourceRef The ref on the remote to fetch.
   * @param localBranch The local branch to create or update.
   * @returns Returns the raw command result.
   */
  private fetchRef(
    root: unknown,
    remote: unknown,
    sourceRef: unknown,
    localBranch: unknown,
  ): Promise<GitRunResult> {
    if (!isSafeOperand(remote) || !isSafeOperand(sourceRef) || !isSafeOperand(localBranch)) {
      return Promise.resolve({ success: false, error: 'Invalid remote, ref, or branch name' });
    }
    if ([remote, sourceRef, localBranch].some((part: string): boolean => part.includes(':'))) {
      return Promise.resolve({ success: false, error: 'Invalid remote, ref, or branch name' });
    }
    logger.trace('GitManager.fetchRef', `Fetching ${remote} ${sourceRef} into ${localBranch}`);
    return this.runNetwork(root, ['fetch', remote, `${sourceRef}:${localBranch}`]);
  }

  /**
   * Pulls the current branch from its configured upstream. A merge conflict or a non-fast-forward
   * leaves git's message in stderr for the renderer to surface.
   * @param root The repository root.
   * @returns Returns the raw command result.
   */
  private pull(root: unknown): Promise<GitRunResult> {
    logger.trace('GitManager.pull', 'Pulling current branch from upstream');
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
  private push(
    root: unknown,
    remote: unknown,
    branch: unknown,
    setUpstream: unknown,
  ): Promise<GitRunResult> {
    if (remote === undefined && branch === undefined) {
      logger.trace('GitManager.push', 'Pushing to configured upstream');
      return this.runNetwork(root, ['push']);
    }
    if (!isSafeOperand(remote) || !isSafeOperand(branch)) {
      return Promise.resolve({ success: false, error: 'Invalid push upstream' });
    }
    // Naming the branch is what lets a branch that is not checked out be pushed at all; whether the
    // upstream is claimed on the way is a separate question, and a branch that already has one must
    // not have it silently repointed.
    if (setUpstream === false) {
      logger.trace('GitManager.push', `Pushing ${branch} to ${remote}`);
      return this.runNetwork(root, ['push', remote, branch]);
    }
    logger.trace('GitManager.push', `Pushing and setting upstream ${remote}/${branch}`);
    return this.runNetwork(root, ['push', '--set-upstream', remote, branch]);
  }

  /**
   * Merges a branch into the checked-out one.
   *
   * `--no-edit` is not decoration: without it git opens an editor for the merge message and, with no
   * terminal to open one in, waits for an answer that cannot come.
   *
   * @param root The repository root.
   * @param branch The branch to merge in.
   * @param mode How the merge records its result.
   * @returns Returns the raw command result.
   */
  private merge(root: unknown, branch: unknown, mode: unknown): Promise<GitRunResult> {
    if (!isSafeOperand(branch)) {
      return Promise.resolve({ success: false, error: 'Invalid branch name' });
    }
    // A squash neither commits nor records a merge, so it has no message to decline to edit.
    const options: readonly string[] =
      mode === 'squash'
        ? ['--squash']
        : mode === 'no-ff'
          ? ['--no-ff', '--no-edit']
          : ['--no-edit'];
    logger.info('GitManager.merge', `Merging ${branch} (${String(mode)})`);
    return this.runIntegration(root, ['merge', ...options, branch]);
  }

  /**
   * Replays the checked-out branch onto another. Rewrites history; the caller confirms first.
   * @param root The repository root.
   * @param onto The branch to replay onto.
   * @returns Returns the raw command result.
   */
  private rebase(root: unknown, onto: unknown): Promise<GitRunResult> {
    if (!isSafeOperand(onto)) {
      return Promise.resolve({ success: false, error: 'Invalid branch name' });
    }
    logger.info('GitManager.rebase', `Rebasing onto ${onto}`);
    return this.runIntegration(root, ['rebase', onto]);
  }

  /**
   * Carries on the operation in flight, once its conflicts have been resolved.
   *
   * Which command that is follows from the operation the repository is actually in, read here rather
   * than taken from the caller: the renderer's idea of the state is a snapshot that anything — a
   * terminal in the next tab, an abort a moment ago — may since have made false, and the cost of
   * being wrong is running the wrong command against a half-finished operation.
   *
   * @param root The repository root.
   * @returns Returns the raw command result.
   */
  private async continueOperation(root: unknown): Promise<GitRunResult> {
    const state: GitOperationState = await this.operationState(root);
    switch (state.kind) {
      case 'rebase':
        return this.runIntegration(root, ['rebase', '--continue']);
      case 'merge':
        return this.runIntegration(root, ['merge', '--continue']);
      case 'cherry-pick':
        return this.runIntegration(root, ['cherry-pick', '--continue']);
      case 'revert':
        return this.runIntegration(root, ['revert', '--continue']);
      case 'squash-merge':
        // There is nothing for git to carry on: a squash records no merge, so what is staged is
        // committed like any other change, with a message of the user's own.
        return {
          success: false,
          error: 'A squashed merge is finished by committing the staged result.',
          code: SourceControlCode.SquashCommitRequired,
        };
      default:
        return { success: false, error: NO_OPERATION_ERROR, code: SourceControlCode.NoOperation };
    }
  }

  /**
   * Skips the commit the operation in flight is stuck on, dropping its changes.
   * @param root The repository root.
   * @returns Returns the raw command result.
   */
  private async skipOperation(root: unknown): Promise<GitRunResult> {
    const state: GitOperationState = await this.operationState(root);
    switch (state.kind) {
      case 'rebase':
        return this.runIntegration(root, ['rebase', '--skip']);
      case 'cherry-pick':
        return this.runIntegration(root, ['cherry-pick', '--skip']);
      case null:
        return { success: false, error: NO_OPERATION_ERROR, code: SourceControlCode.NoOperation };
      default:
        // A merge applies one change rather than a sequence, so there is no next commit to move on to.
        return {
          success: false,
          error: 'This operation applies a single change, so there is nothing to skip.',
          code: SourceControlCode.SkipUnsupported,
        };
    }
  }

  /**
   * Abandons the operation in flight, returning the working tree to where it started.
   *
   * A squash merge is the exception that makes reading the state worthwhile: it records no
   * `MERGE_HEAD`, so `git merge --abort` refuses it outright with "there is no merge to abort". What
   * undoes it is a reset back to the head it never left — `--merge` rather than `--hard`, so a change
   * the merge did not touch is not destroyed along with it.
   *
   * @param root The repository root.
   * @returns Returns the raw command result.
   */
  private async abortOperation(root: unknown): Promise<GitRunResult> {
    const state: GitOperationState = await this.operationState(root);
    logger.info('GitManager.abortOperation', `Aborting ${state.kind ?? 'nothing'}`);
    switch (state.kind) {
      case 'rebase':
        return this.runIntegration(root, ['rebase', '--abort']);
      case 'merge':
        return this.runIntegration(root, ['merge', '--abort']);
      case 'cherry-pick':
        return this.runIntegration(root, ['cherry-pick', '--abort']);
      case 'revert':
        return this.runIntegration(root, ['revert', '--abort']);
      case 'squash-merge':
        return this.runIntegration(root, ['reset', '--merge']);
      default:
        return { success: false, error: NO_OPERATION_ERROR, code: SourceControlCode.NoOperation };
    }
  }

  /**
   * Creates a tag at a commit, annotated when a message is given.
   *
   * The message is the one argument not held to {@link isSafeOperand}: it is bound positionally to
   * `-m`, so git reads it as that option's value however it begins, and refusing a message that
   * happens to start with a dash would reject a legitimate one for no gain. It is still its own argv
   * element, never a shell string.
   *
   * @param root The repository root.
   * @param name The tag name.
   * @param commit The commit to tag.
   * @param message The annotation message, or undefined for a lightweight tag.
   * @returns Returns the raw command result.
   */
  private createTag(
    root: unknown,
    name: unknown,
    commit: unknown,
    message: unknown,
  ): Promise<GitRunResult> {
    if (!isSafeOperand(name) || !isSafeOperand(commit)) {
      return Promise.resolve({ success: false, error: 'Invalid tag name or commit' });
    }
    if (message !== undefined && (typeof message !== 'string' || message.length === 0)) {
      return Promise.resolve({ success: false, error: 'Invalid tag message' });
    }
    logger.trace(
      'GitManager.createTag',
      `Creating ${message === undefined ? 'lightweight' : 'annotated'} tag ${name} at ${commit}`,
    );
    return message === undefined
      ? this.runInRoot(root, ['tag', name, commit])
      : this.runInRoot(root, ['tag', '-a', name, '-m', message, commit]);
  }

  /**
   * Deletes a local tag. Destructive; the caller confirms first.
   * @param root The repository root.
   * @param name The tag name.
   * @returns Returns the raw command result.
   */
  private deleteTag(root: unknown, name: unknown): Promise<GitRunResult> {
    if (!isSafeOperand(name)) {
      return Promise.resolve({ success: false, error: 'Invalid tag name' });
    }
    logger.trace('GitManager.deleteTag', `Deleting tag ${name}`);
    return this.runInRoot(root, ['tag', '-d', name]);
  }

  /**
   * Deletes a tag on a remote.
   *
   * The ref is spelled out in full as `refs/tags/<name>` rather than left to git to resolve: a bare
   * name would match a branch of the same name just as readily, and deleting the wrong one on a
   * remote is not a mistake the user can quietly undo. `--delete` takes a plain target ref, so the
   * colon guard holds the operand to one ref rather than a source-and-destination pair.
   *
   * @param root The repository root.
   * @param remote The remote to delete on.
   * @param name The tag name.
   * @returns Returns the raw command result.
   */
  private deleteRemoteTag(root: unknown, remote: unknown, name: unknown): Promise<GitRunResult> {
    if (!isSafeOperand(remote) || !isSafeOperand(name)) {
      return Promise.resolve({ success: false, error: 'Invalid remote or tag name' });
    }
    if (remote.includes(':') || name.includes(':')) {
      return Promise.resolve({ success: false, error: 'Invalid remote or tag name' });
    }
    logger.trace('GitManager.deleteRemoteTag', `Deleting tag ${name} on ${remote}`);
    return this.runNetwork(root, ['push', remote, '--delete', `refs/tags/${name}`]);
  }

  /**
   * Pushes one tag to a remote.
   *
   * Sent as `git push <remote> tag <name>` rather than as a `refs/tags/…` refspec: git's explicit
   * `tag` form names the tag unambiguously without a refspec being built from renderer input at all,
   * so a name carrying a colon cannot become a source-and-destination pair.
   *
   * @param root The repository root.
   * @param remote The remote to push to.
   * @param name The tag name.
   * @returns Returns the raw command result.
   */
  private pushTag(root: unknown, remote: unknown, name: unknown): Promise<GitRunResult> {
    if (!isSafeOperand(remote) || !isSafeOperand(name)) {
      return Promise.resolve({ success: false, error: 'Invalid remote or tag name' });
    }
    logger.trace('GitManager.pushTag', `Pushing tag ${name} to ${remote}`);
    return this.runNetwork(root, ['push', remote, 'tag', name]);
  }

  /**
   * Pushes every local tag to a remote.
   * @param root The repository root.
   * @param remote The remote to push to.
   * @returns Returns the raw command result.
   */
  private pushAllTags(root: unknown, remote: unknown): Promise<GitRunResult> {
    if (!isSafeOperand(remote)) {
      return Promise.resolve({ success: false, error: 'Invalid remote' });
    }
    logger.trace('GitManager.pushAllTags', `Pushing all tags to ${remote}`);
    return this.runNetwork(root, ['push', remote, '--tags']);
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
   * Runs a merge, a rebase, or one of the commands that finishes them: with no editor to block on, a
   * budget that suits work measured in files and commits, and the outcome classified so the caller can
   * tell a conflict from a failure.
   * @param root The repository root, which must be open.
   * @param args The fully-built git argument vector.
   * @returns Returns the raw command result.
   */
  private async runIntegration(root: unknown, args: readonly string[]): Promise<GitRunResult> {
    if (!this.isOpenRoot(root)) {
      return { success: false, error: 'Repository is not open' };
    }
    const result: GitRunResult = await this.run(path.resolve(root), args, {
      env: { ...process.env, ...GIT_NO_EDITOR_ENV },
      timeoutMs: GIT_INTEGRATION_TIMEOUT_MS,
    });
    if (result.success) {
      return result;
    }
    // Git exits non-zero on a conflict exactly as it does on a failure, and the difference is not in
    // the message but in what it left behind: an operation still in flight means it stopped to ask,
    // not that it could not proceed. Asking the repository beats reading the prose.
    const state: GitOperationState = await this.operationState(root);
    return state.kind === null ? result : { ...result, code: SourceControlCode.Conflicted };
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
    }).then((result: GitRunResult): GitRunResult => this.classifyNetworkFailure(result));
  }

  /**
   * Rewrites a failed network operation's raw stderr into an actionable message when it is an
   * authentication failure. Network git runs are deliberately non-interactive (no terminal or GUI
   * credential prompts), so missing credentials fail fast — but the raw git error explains neither
   * why nor what to do about it.
   * @param result The network operation's result.
   * @returns Returns the result, with an authentication failure explained.
   */
  private classifyNetworkFailure(result: GitRunResult): GitRunResult {
    if (result.success) {
      return result;
    }
    const error: string = `${result.error ?? ''} ${result.stderr ?? ''}`;
    if (
      /could not read username|could not read password|authentication failed|invalid username or password|http.*40[13]|terminal prompts disabled/i.test(
        error,
      )
    ) {
      logger.warn('GitManager', 'Network git operation failed authentication (non-interactive)');
      return {
        success: false,
        stderr: result.stderr,
        error:
          'Authentication required. Studio runs git non-interactively, so HTTPS remotes need a ' +
          'configured git credential helper (for example the OS keychain helper or ' +
          'git-credential-manager) holding a valid token. Configure one, verify with a git fetch ' +
          'in a terminal, then retry.',
      };
    }
    if (/permission denied \(publickey\)|host key verification failed/i.test(error)) {
      return {
        success: false,
        stderr: result.stderr,
        error:
          'SSH authentication failed. Studio runs git non-interactively, so SSH remotes need a key ' +
          'loaded in ssh-agent (and the host already in known_hosts). Load your key with ssh-add, ' +
          'verify with a git fetch in a terminal, then retry.',
      };
    }
    return result;
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
   * environment overlay and timeout let network operations run non-interactively with a longer
   * budget. Identical concurrent READ commands share one process: several renderer surfaces watch
   * the same repository (the source-control view, the explorer's decorations, per-checkout views)
   * and a change burst makes them all ask for the same status at once — on a large working tree
   * each status is a full lstat crawl, so duplicates are pure waste.
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
    const dedupKey: string | null = options === undefined ? readDedupKey(cwd, args) : null;
    if (dedupKey !== null) {
      const existing: Promise<GitRunResult> | undefined = this.inFlightReads.get(dedupKey);
      if (existing !== undefined) {
        logger.debug('GitManager.run', `Deduped concurrent read: git ${args.join(' ')}`);
        return existing;
      }
    }
    const result: Promise<GitRunResult> = this.spawnGit(cwd, args, options);
    if (dedupKey !== null) {
      this.inFlightReads.set(dedupKey, result);
      void result.finally((): void => {
        this.inFlightReads.delete(dedupKey);
      });
    }
    return result;
  }

  /**
   * Spawns the actual git process for {@link run}.
   * @param cwd The working directory to run in.
   * @param args The git argument vector.
   * @param options The optional environment and timeout overrides.
   * @returns Returns the raw command result.
   */
  private spawnGit(
    cwd: string,
    args: readonly string[],
    options?: { env?: NodeJS.ProcessEnv; timeoutMs?: number },
  ): Promise<GitRunResult> {
    logger.trace('GitManager.spawnGit', `git ${args.join(' ')} (cwd ${cwd})`);
    return new Promise<GitRunResult>((resolve: (value: GitRunResult) => void): void => {
      execFile(
        'git',
        [...args],
        {
          cwd,
          timeout: options?.timeoutMs ?? GIT_TIMEOUT_MS,
          maxBuffer: GIT_MAX_BUFFER,
          windowsHide: true,
          // Read commands (status in particular) must not opportunistically write the index: the
          // repository root is watched for on-disk changes, and a status that refreshed the index
          // would trigger the watcher that triggered it.
          env: { ...(options?.env ?? process.env), GIT_OPTIONAL_LOCKS: '0' },
        },
        (error: Error | null, stdout: string, stderr: string): void => {
          if (error !== null) {
            // Git failing is often expected (a status in a non-repo, a rejected push), so this is
            // debug, not error; the caller surfaces the outcome to the user.
            logger.debug('GitManager', `git ${args[0] ?? ''} failed: ${error.message}`);
            resolve({ success: false, error: error.message, stderr });
            return;
          }
          resolve({ success: true, stdout, stderr });
        },
      );
    });
  }
}

/**
 * Determines whether a path exists, treating any failure to look as absence — which is what it means
 * here, since these are files git writes only while an operation is unfinished.
 * @param target The absolute path to test.
 * @returns Returns true when the path exists.
 */
async function exists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * Reads the first of several candidate files that exists, trimmed.
 * @param candidates The absolute paths to try, in order.
 * @returns Returns the contents, or null when none of them could be read.
 */
async function firstFile(candidates: readonly string[]): Promise<string | null> {
  for (const candidate of candidates) {
    try {
      return (await readFile(candidate, 'utf8')).trim();
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Reads a file's first line, trimmed.
 * @param target The absolute path to read.
 * @returns Returns the first line, or null when the file could not be read.
 */
async function firstLine(target: string): Promise<string | null> {
  try {
    const content: string = await readFile(target, 'utf8');
    return (content.split('\n')[0] ?? '').trim();
  } catch {
    return null;
  }
}

/**
 * The git subcommands whose invocations are safe to share between concurrent identical callers:
 * read-only forms that never mutate the repository, so two callers receiving one process's output is
 * indistinguishable from two processes. `stash` is included only as `stash list`.
 */
const READ_DEDUP_SUBCOMMANDS: ReadonlySet<string> = new Set<string>([
  'status',
  'log',
  'for-each-ref',
  'rev-list',
  'rev-parse',
  'diff',
  'show',
]);

/**
 * Builds the dedup key for a read-only git invocation, or null when the command may mutate (and must
 * therefore never be shared).
 * @param cwd The working directory.
 * @param args The git argument vector.
 * @returns Returns the key, or null.
 */
function readDedupKey(cwd: string, args: readonly string[]): string | null {
  const subcommand: string | undefined = args[0];
  if (subcommand === undefined) {
    return null;
  }
  const isRead: boolean =
    READ_DEDUP_SUBCOMMANDS.has(subcommand) || (subcommand === 'stash' && args[1] === 'list');
  return isRead ? `${cwd} ${args.join(' ')}` : null;
}
