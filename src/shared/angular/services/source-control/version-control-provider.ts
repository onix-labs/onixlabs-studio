import {
  GitMergeMode,
  GitOperationState,
  SourceControlClient,
} from '@shared/api/source-control-channels';
import {
  VcsCommit,
  VcsFileChange,
  VcsFileVersion,
  VcsStash,
  VcsStatus,
  VersionControlOp,
  VersionControlResponse,
  VcsParams,
  VcsResult,
} from '@shared/api/version-control-protocol';
import { DiffTarget, GitCommit, GitFileChange, GitStash } from '../repository/repository-data';
import { relativeDate } from './relative-date';
import {
  FileDiff,
  MutationResult,
  ParsedRefs,
  ParsedStatus,
  PushTarget,
  SourceControlProvider,
} from './source-control-provider';

/**
 * Holds the default number of commits the history loads.
 */
const DEFAULT_LOG_LIMIT: number = 500;

/**
 * The status of a repository that could not be read: no branch and no changes, so the surfaces render
 * their empty state rather than throwing.
 */
const EMPTY_STATUS: ParsedStatus = {
  branch: null,
  upstream: null,
  ahead: 0,
  behind: 0,
  staged: [],
  unstaged: [],
  conflicted: [],
};

/**
 * Adds to a protocol file change what only the renderer uses: the diff target its contents are loaded
 * from, and the display fields (language, the loaded sides) that start empty.
 * @param change The plugin's file change.
 * @param target Where the change's two sides are read from.
 * @returns Returns the renderer's file change.
 */
function toFileChange(change: VcsFileChange, target: DiffTarget): GitFileChange {
  return {
    path: change.path,
    previousPath: change.previousPath,
    status: change.status,
    additions: change.additions,
    deletions: change.deletions,
    language: '',
    original: '',
    modified: '',
    target,
    untracked: change.untracked,
  };
}

/**
 * Adds to a protocol commit what only the renderer uses: the relative date and the (lazily loaded)
 * files.
 * @param commit The plugin's commit.
 * @returns Returns the renderer's commit.
 */
function toCommit(commit: VcsCommit): GitCommit {
  return { ...commit, relativeDate: relativeDate(commit.isoDate), files: [] };
}

/**
 * Implements {@link SourceControlProvider} over the version-control protocol (#816).
 *
 * Every question goes to the main process, whose host decides which plugin answers for this
 * repository; the answers arrive typed, so nothing here parses a tool's output. What remains is the
 * renderer's own business: attaching diff targets, phrasing dates, and turning a failed read into an
 * empty one so a surface renders its empty state. Running outside Electron (no client) every read
 * yields empty data in the same way.
 */
export class VersionControlProvider implements SourceControlProvider {
  /**
   * Holds the repository's absolute root path.
   */
  public readonly root: string;

  /**
   * Holds the source-control client, or undefined when running outside Electron.
   */
  private readonly api: SourceControlClient | undefined;

  /**
   * Initialises a new instance bound to a repository root.
   * @param root The repository's absolute root path.
   * @param client The source-control client, or undefined when running outside Electron.
   */
  public constructor(root: string, client: SourceControlClient | undefined) {
    this.root = root;
    this.api = client;
  }

  /**
   * Reads the working-tree status.
   * @returns Returns the status, empty when it could not be read.
   */
  public async getStatus(): Promise<ParsedStatus> {
    const status: VcsStatus | null = await this.read('status', {});
    if (status === null) {
      return EMPTY_STATUS;
    }
    const working: (staged: boolean) => (change: VcsFileChange) => GitFileChange =
      (staged: boolean) =>
      (change: VcsFileChange): GitFileChange =>
        toFileChange(change, { kind: 'working', staged });
    return {
      branch: status.branch,
      upstream: status.upstream,
      ahead: status.ahead,
      behind: status.behind,
      staged: status.staged.map(working(true)),
      unstaged: status.unstaged.map(working(false)),
      conflicted: status.conflicted.map(working(false)),
    };
  }

  /**
   * Reads the multi-step operation the repository is in the middle of, if any.
   * @returns Returns the operation state, whose kind is null when nothing is in flight.
   */
  public async getOperationState(): Promise<GitOperationState> {
    return (await this.read('operationState', {})) ?? { kind: null };
  }

  /**
   * Reads the commit history.
   * @param limit The maximum number of commits to read.
   * @returns Returns the commits.
   */
  public async getCommits(limit: number = DEFAULT_LOG_LIMIT): Promise<GitCommit[]> {
    return ((await this.read('log', { limit })) ?? []).map(toCommit);
  }

  /**
   * Reads the branches, remotes, and tags.
   * @returns Returns the refs.
   */
  public async getRefs(): Promise<ParsedRefs> {
    return (await this.read('refs', {})) ?? { branches: [], remotes: [], tags: [] };
  }

  /**
   * Reads the stash entries.
   * @returns Returns the stashes.
   */
  public async getStashes(): Promise<GitStash[]> {
    return ((await this.read('stashes', {})) ?? []).map((stash: VcsStash): GitStash => ({
      index: stash.index,
      message: stash.message,
      branch: stash.branch,
      files: stash.files.map((change: VcsFileChange): GitFileChange =>
        toFileChange(change, { kind: 'working', staged: false }),
      ),
    }));
  }

  /**
   * Reads the files changed by a commit, attaching each file's commit diff target.
   * @param commit The commit to inspect.
   * @returns Returns the changed files.
   */
  public async getCommitFiles(commit: GitCommit): Promise<GitFileChange[]> {
    const target: DiffTarget = {
      kind: 'commit',
      hash: commit.hash,
      parent: commit.parents[0] ?? null,
    };
    return ((await this.read('commitFiles', { hash: commit.hash })) ?? []).map(
      (change: VcsFileChange): GitFileChange => toFileChange(change, target),
    );
  }

  /**
   * Reads the two sides of a changed file's diff. A change with no target (a mock change) returns its
   * embedded contents directly.
   * @param file The changed file.
   * @returns Returns the diff content.
   */
  public async getFileDiff(file: GitFileChange): Promise<FileDiff> {
    if (file.target === undefined) {
      return { original: file.original, modified: file.modified };
    }
    const newPath: string = file.path;
    const oldPath: string = file.previousPath ?? file.path;

    if (file.target.kind === 'commit') {
      // A root commit has no parent, and every file in it is added.
      const parent: string | null = file.target.parent;
      const original: string =
        file.status === 'added' || parent === null
          ? ''
          : await this.contents(oldPath, { kind: 'commit', hash: parent });
      const modified: string =
        file.status === 'deleted'
          ? ''
          : await this.contents(newPath, { kind: 'commit', hash: file.target.hash });
      return { original, modified };
    }

    // A conflicted path has no single staged version to compare against — the index holds all three
    // sides at once — so our side of the conflict is compared with what is on disk instead, which is
    // what resolving it has to settle.
    if (file.status === 'conflicted') {
      return {
        original: await this.contents(newPath, { kind: 'ours' }),
        modified: await this.contents(newPath, { kind: 'working' }),
      };
    }

    // Staged compares HEAD with the index; unstaged compares the index with the working tree.
    if (file.target.staged) {
      return {
        original: await this.contents(newPath, { kind: 'head' }),
        modified: await this.contents(newPath, { kind: 'index' }),
      };
    }
    return {
      original: await this.contents(newPath, { kind: 'index' }),
      modified: await this.contents(newPath, { kind: 'working' }),
    };
  }

  /**
   * Stages paths (or the whole working tree).
   * @param paths The repository-relative paths to stage, or an empty array for everything.
   * @returns Returns the outcome.
   */
  public stage(paths: readonly string[]): Promise<MutationResult> {
    return this.mutate('stage', { paths });
  }

  /**
   * Discards the uncommitted changes to paths (tracked restored, untracked deleted).
   * @param paths The repository-relative paths to discard; must not be empty.
   * @returns Returns the outcome.
   */
  public discard(paths: readonly string[]): Promise<MutationResult> {
    return this.mutate('discard', { paths });
  }

  /**
   * Unstages paths (or the whole index).
   * @param paths The repository-relative paths to unstage, or an empty array for everything.
   * @returns Returns the outcome.
   */
  public unstage(paths: readonly string[]): Promise<MutationResult> {
    return this.mutate('unstage', { paths });
  }

  /**
   * Commits the staged changes.
   * @param message The commit message.
   * @returns Returns the outcome.
   */
  public commit(message: string): Promise<MutationResult> {
    return this.mutate('commit', { message });
  }

  /**
   * Stashes the working-tree changes.
   * @returns Returns the outcome.
   */
  public stash(): Promise<MutationResult> {
    return this.mutate('stash', {});
  }

  /**
   * Restores a stash onto the working tree, keeping it on the stack.
   * @param index The stack index of the stash (0 is the most recent).
   * @returns Returns the outcome.
   */
  public applyStash(index: number): Promise<MutationResult> {
    return this.mutate('stashApply', { index });
  }

  /**
   * Restores a stash onto the working tree and drops it from the stack.
   * @param index The stack index of the stash (0 is the most recent).
   * @returns Returns the outcome.
   */
  public popStash(index: number): Promise<MutationResult> {
    return this.mutate('stashPop', { index });
  }

  /**
   * Deletes a stash without restoring it. Destructive; the caller confirms first.
   * @param index The stack index of the stash (0 is the most recent).
   * @returns Returns the outcome.
   */
  public dropStash(index: number): Promise<MutationResult> {
    return this.mutate('stashDrop', { index });
  }

  /**
   * Checks out an existing branch.
   * @param branch The branch name.
   * @returns Returns the outcome.
   */
  public checkout(branch: string): Promise<MutationResult> {
    return this.mutate('checkout', { branch });
  }

  /**
   * Creates a branch at the current head, optionally checking it out.
   * @param name The new branch name.
   * @param checkout Whether to check the new branch out.
   * @returns Returns the outcome.
   */
  public createBranch(name: string, checkout: boolean): Promise<MutationResult> {
    return this.mutate('createBranch', { name, checkout });
  }

  /**
   * Fetches all remotes, pruning deleted remote-tracking branches.
   * @returns Returns the outcome.
   */
  public fetch(): Promise<MutationResult> {
    return this.mutate('fetch', {});
  }

  /**
   * Fetches one ref from a remote into a local branch.
   * @param remote The remote to fetch from.
   * @param sourceRef The ref on the remote to fetch.
   * @param localBranch The local branch to create or update.
   * @returns Returns the outcome.
   */
  public fetchRef(remote: string, sourceRef: string, localBranch: string): Promise<MutationResult> {
    return this.mutate('fetchRef', { remote, sourceRef, localBranch });
  }

  /**
   * Pulls the current branch from its upstream.
   * @returns Returns the outcome.
   */
  public pull(): Promise<MutationResult> {
    return this.mutate('pull', {});
  }

  /**
   * Pushes a branch, or the checked-out one to its upstream when no target is given.
   * @param target The branch to push and where.
   * @returns Returns the outcome.
   */
  public push(target?: PushTarget): Promise<MutationResult> {
    return this.mutate('push', { target: target ?? null });
  }

  /**
   * Deletes a local branch. Destructive; the caller confirms first.
   * @param name The branch name.
   * @param force Whether to delete a branch whose commits are not merged anywhere.
   * @returns Returns the outcome.
   */
  public deleteBranch(name: string, force: boolean): Promise<MutationResult> {
    return this.mutate('deleteBranch', { name, force });
  }

  /**
   * Renames a local branch, including the checked-out one.
   * @param from The current branch name.
   * @param to The new branch name.
   * @returns Returns the outcome.
   */
  public renameBranch(from: string, to: string): Promise<MutationResult> {
    return this.mutate('renameBranch', { from, to });
  }

  /**
   * Points a local branch's upstream at a remote-tracking branch, or clears it.
   * @param branch The local branch.
   * @param upstream The remote-tracking branch to track, or null to clear the upstream.
   * @returns Returns the outcome.
   */
  public setUpstream(branch: string, upstream: string | null): Promise<MutationResult> {
    return this.mutate('setUpstream', { branch, upstream });
  }

  /**
   * Fetches one remote, rather than all of them.
   * @param remote The remote to fetch.
   * @returns Returns the outcome.
   */
  public fetchRemote(remote: string): Promise<MutationResult> {
    return this.mutate('fetchRemote', { remote });
  }

  /**
   * Prunes one remote's tracking branches that no longer exist on it.
   * @param remote The remote to prune.
   * @returns Returns the outcome.
   */
  public pruneRemote(remote: string): Promise<MutationResult> {
    return this.mutate('pruneRemote', { remote });
  }

  /**
   * Adds a remote.
   * @param name The remote name.
   * @param url The remote URL.
   * @returns Returns the outcome.
   */
  public addRemote(name: string, url: string): Promise<MutationResult> {
    return this.mutate('addRemote', { name, url });
  }

  /**
   * Removes a remote, along with its tracking branches.
   * @param name The remote name.
   * @returns Returns the outcome.
   */
  public removeRemote(name: string): Promise<MutationResult> {
    return this.mutate('removeRemote', { name });
  }

  /**
   * Creates a local branch tracking a remote-tracking branch, and checks it out.
   * @param remoteBranch The remote-tracking branch, as `origin/main`.
   * @param localBranch The local branch to create.
   * @returns Returns the outcome.
   */
  public checkoutTracking(remoteBranch: string, localBranch: string): Promise<MutationResult> {
    return this.mutate('checkoutTracking', { remoteBranch, localBranch });
  }

  /**
   * Merges a branch into the checked-out one.
   * @param branch The branch to merge in.
   * @param mode How the merge records its result.
   * @returns Returns the outcome.
   */
  public merge(branch: string, mode: GitMergeMode): Promise<MutationResult> {
    return this.mutate('merge', { branch, mode });
  }

  /**
   * Replays the checked-out branch onto another.
   * @param onto The branch to replay onto.
   * @returns Returns the outcome.
   */
  public rebase(onto: string): Promise<MutationResult> {
    return this.mutate('rebase', { onto });
  }

  /**
   * Carries on the operation in flight, once its conflicts have been resolved.
   * @returns Returns the outcome.
   */
  public continueOperation(): Promise<MutationResult> {
    return this.mutate('operationContinue', {});
  }

  /**
   * Skips the commit the operation in flight is stuck on.
   * @returns Returns the outcome.
   */
  public skipOperation(): Promise<MutationResult> {
    return this.mutate('operationSkip', {});
  }

  /**
   * Abandons the operation in flight, returning the working tree to where it started.
   * @returns Returns the outcome.
   */
  public abortOperation(): Promise<MutationResult> {
    return this.mutate('operationAbort', {});
  }

  /**
   * Creates a tag at a commit, annotated when a message is given.
   * @param name The tag name.
   * @param commit The commit to tag.
   * @param message The annotation message, or undefined for a lightweight tag.
   * @returns Returns the outcome.
   */
  public createTag(name: string, commit: string, message?: string): Promise<MutationResult> {
    return this.mutate('createTag', {
      name,
      commit,
      ...(message === undefined ? {} : { message }),
    });
  }

  /**
   * Deletes a local tag. Destructive; the caller confirms first.
   * @param name The tag name.
   * @returns Returns the outcome.
   */
  public deleteTag(name: string): Promise<MutationResult> {
    return this.mutate('deleteTag', { name });
  }

  /**
   * Deletes a tag on a remote. Destructive for everyone who has fetched it, not just the caller.
   * @param remote The remote to delete on.
   * @param name The tag name.
   * @returns Returns the outcome.
   */
  public deleteRemoteTag(remote: string, name: string): Promise<MutationResult> {
    return this.mutate('deleteRemoteTag', { remote, name });
  }

  /**
   * Pushes one tag to a remote.
   * @param remote The remote to push to.
   * @param name The tag name.
   * @returns Returns the outcome.
   */
  public pushTag(remote: string, name: string): Promise<MutationResult> {
    return this.mutate('pushTag', { remote, name });
  }

  /**
   * Pushes every local tag to a remote.
   * @param remote The remote to push to.
   * @returns Returns the outcome.
   */
  public pushAllTags(remote: string): Promise<MutationResult> {
    return this.mutate('pushAllTags', { remote });
  }

  /**
   * Releases the repository in the main process.
   * @returns Returns a promise that resolves once the repository has been released.
   */
  public async close(): Promise<void> {
    await (this.api?.closeRepository(this.root) ?? Promise.resolve());
  }

  /**
   * Performs a read, yielding null when there is no client or it failed — a surface shows its empty
   * state rather than an error for a read.
   * @param op The operation.
   * @param params The operation's parameters.
   * @returns Returns the result, or null.
   */
  private async read<Op extends VersionControlOp>(
    op: Op,
    params: VcsParams<Op>,
  ): Promise<VcsResult<Op> | null> {
    if (this.api === undefined) {
      return null;
    }
    const response: VersionControlResponse<Op> = await this.api.request(this.root, op, params);
    return response.ok ? response.result : null;
  }

  /**
   * Performs a mutation, mapping its answer to a {@link MutationResult}.
   * @param op The operation.
   * @param params The operation's parameters.
   * @returns Returns the outcome; a failure when there is no client.
   */
  private async mutate<Op extends VersionControlOp>(
    op: Op,
    params: VcsParams<Op>,
  ): Promise<MutationResult> {
    if (this.api === undefined) {
      return { success: false, error: 'Source control is unavailable' };
    }
    const response: VersionControlResponse<Op> = await this.api.request(this.root, op, params);
    return response.ok
      ? { success: true }
      : { success: false, error: response.error, code: response.code };
  }

  /**
   * Reads one version of a file, empty when it does not exist there or could not be read.
   * @param filePath The repository-relative path.
   * @param version The version.
   * @returns Returns the contents.
   */
  private async contents(filePath: string, version: VcsFileVersion): Promise<string> {
    return (await this.read('readFile', { path: filePath, version }))?.content ?? '';
  }
}
