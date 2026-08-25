import { GitRunResult, SourceControlClient } from '@shared/api/source-control-channels';
import { GitCommit, GitFileChange, GitStash } from '../repository/repository-data';
import {
  ParsedRefs,
  ParsedStatus,
  parseCommitFiles,
  parseLog,
  mergeRemoteUrls,
  parseRefs,
  parseRemoteUrls,
  parseStashes,
  parseStatus,
} from './git-output';
import {
  FileDiff,
  MutationResult,
  PushTarget,
  SourceControlProvider,
} from './source-control-provider';

/**
 * Holds the default number of commits the history loads.
 */
const DEFAULT_LOG_LIMIT: number = 500;

/**
 * The revision naming the staged content. Not a revision *name* but git's way of writing a blob with
 * no revision in front of it, which is why the main process cannot join it to a path the way it joins
 * a real one — see `blobSpec` there.
 */
const INDEX_REVISION: string = ':';

/**
 * The revision naming the working tree, read from disk rather than from the object store.
 */
const WORKTREE_REVISION: string = '';

/**
 * The revision naming the tip of the current branch.
 */
const HEAD_REVISION: string = 'HEAD';

/**
 * The git implementation of {@link SourceControlProvider}. It calls the safe git client (the
 * {@link SourceControlClient} over `window.bridge`) for a single opened repository root and maps the
 * raw output through the {@link import('./git-output')} parsers into the application's source-control
 * model. Running outside Electron (no client) every read yields empty data, so the surfaces render
 * their empty state rather than throwing.
 */
export class GitProvider implements SourceControlProvider {
  /**
   * Holds the repository's absolute root path.
   */
  public readonly root: string;

  /**
   * Holds the git client, or undefined when running outside Electron.
   */
  private readonly api: SourceControlClient | undefined;

  /**
   * Initialises a new instance of the {@link GitProvider} class bound to a repository root.
   * @param root The repository's absolute root path.
   * @param client The source-control client, or undefined when running outside Electron.
   */
  public constructor(root: string, client: SourceControlClient | undefined) {
    this.root = root;
    this.api = client;
  }

  /**
   * Reads the working-tree status.
   * @returns Returns the parsed status.
   */
  public async getStatus(): Promise<ParsedStatus> {
    return parseStatus(
      await this.read((api: SourceControlClient): Promise<GitRunResult> => api.status(this.root)),
    );
  }

  /**
   * Reads the commit history.
   * @param limit The maximum number of commits to read.
   * @returns Returns the commits.
   */
  public async getCommits(limit: number = DEFAULT_LOG_LIMIT): Promise<GitCommit[]> {
    return parseLog(
      await this.read(
        (api: SourceControlClient): Promise<GitRunResult> => api.log(this.root, limit),
      ),
    );
  }

  /**
   * Reads the branches, remotes, and tags.
   * @returns Returns the parsed refs.
   */
  public async getRefs(): Promise<ParsedRefs> {
    // Two reads rather than one: `for-each-ref` knows the remote-tracking branches but nothing of a
    // remote's URL, and `git remote -v` knows the URLs but nothing of the branches. Run together,
    // since neither touches the network and the pair is what one caller wants.
    const [refs, remoteUrls]: [string, string] = await Promise.all([
      this.read((api: SourceControlClient): Promise<GitRunResult> => api.refs(this.root)),
      this.read((api: SourceControlClient): Promise<GitRunResult> => api.remotes(this.root)),
    ]);
    const parsed: ParsedRefs = parseRefs(refs);
    return { ...parsed, remotes: mergeRemoteUrls(parsed.remotes, parseRemoteUrls(remoteUrls)) };
  }

  /**
   * Reads the stash entries.
   * @returns Returns the stashes.
   */
  public async getStashes(): Promise<GitStash[]> {
    return parseStashes(
      await this.read((api: SourceControlClient): Promise<GitRunResult> => api.stashes(this.root)),
    );
  }

  /**
   * Reads the files changed by a commit, attaching each file's commit diff target.
   * @param commit The commit to inspect.
   * @returns Returns the changed files.
   */
  public async getCommitFiles(commit: GitCommit): Promise<GitFileChange[]> {
    const output: string = await this.read(
      (api: SourceControlClient): Promise<GitRunResult> => api.commitFiles(this.root, commit.hash),
    );
    return parseCommitFiles(output, commit.hash, commit.parents[0] ?? null);
  }

  /**
   * Reads the two sides of a changed file's diff, resolving its revision context. A change with no
   * target (a mock change) returns its embedded contents directly.
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
      const parentRevision: string = file.target.parent ?? `${file.target.hash}^`;
      const original: string =
        file.status === 'added' ? '' : await this.blob(parentRevision, oldPath);
      const modified: string =
        file.status === 'deleted' ? '' : await this.blob(file.target.hash, newPath);
      return { original, modified };
    }

    // Working tree: staged compares HEAD with the index; unstaged compares the index with the worktree.
    if (file.target.staged) {
      return {
        original: await this.blob(HEAD_REVISION, newPath),
        modified: await this.blob(INDEX_REVISION, newPath),
      };
    }
    return {
      original: await this.blob(INDEX_REVISION, newPath),
      modified: await this.blob(WORKTREE_REVISION, newPath),
    };
  }

  /**
   * Stages paths (or the whole working tree).
   * @param paths The repository-relative paths to stage, or an empty array for everything.
   * @returns Returns the outcome.
   */
  public stage(paths: readonly string[]): Promise<MutationResult> {
    return this.mutate(
      (api: SourceControlClient): Promise<GitRunResult> => api.stage(this.root, paths),
    );
  }

  /**
   * Discards the uncommitted changes to paths (tracked restored to `HEAD`, untracked deleted).
   * @param paths The repository-relative paths to discard; must not be empty.
   * @returns Returns the outcome.
   */
  public discard(paths: readonly string[]): Promise<MutationResult> {
    return this.mutate(
      (api: SourceControlClient): Promise<GitRunResult> => api.discard(this.root, paths),
    );
  }

  /**
   * Unstages paths (or the whole index).
   * @param paths The repository-relative paths to unstage, or an empty array for everything.
   * @returns Returns the outcome.
   */
  public unstage(paths: readonly string[]): Promise<MutationResult> {
    return this.mutate(
      (api: SourceControlClient): Promise<GitRunResult> => api.unstage(this.root, paths),
    );
  }

  /**
   * Commits the staged changes.
   * @param message The commit message.
   * @returns Returns the outcome.
   */
  public commit(message: string): Promise<MutationResult> {
    return this.mutate(
      (api: SourceControlClient): Promise<GitRunResult> => api.commit(this.root, message),
    );
  }

  /**
   * Stashes the working-tree changes.
   * @returns Returns the outcome.
   */
  public stash(): Promise<MutationResult> {
    return this.mutate((api: SourceControlClient): Promise<GitRunResult> => api.stash(this.root));
  }

  /**
   * Restores a stash onto the working tree, keeping it on the stack.
   * @param index The stack index of the stash (0 is the most recent).
   * @returns Returns the outcome.
   */
  public applyStash(index: number): Promise<MutationResult> {
    return this.mutate(
      (api: SourceControlClient): Promise<GitRunResult> => api.stashApply(this.root, index),
    );
  }

  /**
   * Restores a stash onto the working tree and drops it from the stack.
   * @param index The stack index of the stash (0 is the most recent).
   * @returns Returns the outcome.
   */
  public popStash(index: number): Promise<MutationResult> {
    return this.mutate(
      (api: SourceControlClient): Promise<GitRunResult> => api.stashPop(this.root, index),
    );
  }

  /**
   * Deletes a stash without restoring it. Destructive; the caller confirms first.
   * @param index The stack index of the stash (0 is the most recent).
   * @returns Returns the outcome.
   */
  public dropStash(index: number): Promise<MutationResult> {
    return this.mutate(
      (api: SourceControlClient): Promise<GitRunResult> => api.stashDrop(this.root, index),
    );
  }

  /**
   * Checks out an existing branch.
   * @param branch The branch name.
   * @returns Returns the outcome.
   */
  public checkout(branch: string): Promise<MutationResult> {
    return this.mutate(
      (api: SourceControlClient): Promise<GitRunResult> => api.checkout(this.root, branch),
    );
  }

  /**
   * Creates a branch at the current head, optionally checking it out.
   * @param name The new branch name.
   * @param checkout Whether to check the new branch out.
   * @returns Returns the outcome.
   */
  public createBranch(name: string, checkout: boolean): Promise<MutationResult> {
    return this.mutate(
      (api: SourceControlClient): Promise<GitRunResult> =>
        api.createBranch(this.root, name, checkout),
    );
  }

  /**
   * Fetches all remotes, pruning deleted remote-tracking branches.
   * @returns Returns the outcome.
   */
  public fetch(): Promise<MutationResult> {
    return this.mutate((api: SourceControlClient): Promise<GitRunResult> => api.fetch(this.root));
  }

  /**
   * Fetches one ref from a remote into a local branch.
   * @param remote The remote to fetch from.
   * @param sourceRef The ref on the remote to fetch.
   * @param localBranch The local branch to create or update.
   * @returns Returns the outcome.
   */
  public fetchRef(remote: string, sourceRef: string, localBranch: string): Promise<MutationResult> {
    return this.mutate(
      (api: SourceControlClient): Promise<GitRunResult> =>
        api.fetchRef(this.root, remote, sourceRef, localBranch),
    );
  }

  /**
   * Pulls the current branch from its upstream.
   * @returns Returns the outcome.
   */
  public pull(): Promise<MutationResult> {
    return this.mutate((api: SourceControlClient): Promise<GitRunResult> => api.pull(this.root));
  }

  /**
   * Pushes a branch, or the checked-out one to its upstream when no target is given.
   * @param target The branch to push and where.
   * @returns Returns the outcome.
   */
  public push(target?: PushTarget): Promise<MutationResult> {
    return this.mutate(
      (api: SourceControlClient): Promise<GitRunResult> =>
        api.push(this.root, target?.remote, target?.branch, target?.setUpstream),
    );
  }

  /**
   * Deletes a local branch. Destructive; the caller confirms first.
   * @param name The branch name.
   * @param force Whether to delete a branch whose commits are not merged anywhere.
   * @returns Returns the outcome.
   */
  public deleteBranch(name: string, force: boolean): Promise<MutationResult> {
    return this.mutate(
      (api: SourceControlClient): Promise<GitRunResult> => api.deleteBranch(this.root, name, force),
    );
  }

  /**
   * Renames a local branch, including the checked-out one.
   * @param from The current branch name.
   * @param to The new branch name.
   * @returns Returns the outcome.
   */
  public renameBranch(from: string, to: string): Promise<MutationResult> {
    return this.mutate(
      (api: SourceControlClient): Promise<GitRunResult> => api.renameBranch(this.root, from, to),
    );
  }

  /**
   * Points a local branch's upstream at a remote-tracking branch, or clears it.
   * @param branch The local branch.
   * @param upstream The remote-tracking branch to track, or null to clear the upstream.
   * @returns Returns the outcome.
   */
  public setUpstream(branch: string, upstream: string | null): Promise<MutationResult> {
    return this.mutate(
      (api: SourceControlClient): Promise<GitRunResult> =>
        api.setUpstream(this.root, branch, upstream),
    );
  }

  /**
   * Fetches one remote, rather than all of them.
   * @param remote The remote to fetch.
   * @returns Returns the outcome.
   */
  public fetchRemote(remote: string): Promise<MutationResult> {
    return this.mutate(
      (api: SourceControlClient): Promise<GitRunResult> => api.fetchRemote(this.root, remote),
    );
  }

  /**
   * Prunes one remote's tracking branches that no longer exist on it.
   * @param remote The remote to prune.
   * @returns Returns the outcome.
   */
  public pruneRemote(remote: string): Promise<MutationResult> {
    return this.mutate(
      (api: SourceControlClient): Promise<GitRunResult> => api.pruneRemote(this.root, remote),
    );
  }

  /**
   * Adds a remote.
   * @param name The remote name.
   * @param url The remote URL.
   * @returns Returns the outcome.
   */
  public addRemote(name: string, url: string): Promise<MutationResult> {
    return this.mutate(
      (api: SourceControlClient): Promise<GitRunResult> => api.addRemote(this.root, name, url),
    );
  }

  /**
   * Removes a remote, along with its tracking branches.
   * @param name The remote name.
   * @returns Returns the outcome.
   */
  public removeRemote(name: string): Promise<MutationResult> {
    return this.mutate(
      (api: SourceControlClient): Promise<GitRunResult> => api.removeRemote(this.root, name),
    );
  }

  /**
   * Creates a local branch tracking a remote-tracking branch, and checks it out.
   * @param remoteBranch The remote-tracking branch, as `origin/main`.
   * @param localBranch The local branch to create.
   * @returns Returns the outcome.
   */
  public checkoutTracking(remoteBranch: string, localBranch: string): Promise<MutationResult> {
    return this.mutate(
      (api: SourceControlClient): Promise<GitRunResult> =>
        api.checkoutTracking(this.root, remoteBranch, localBranch),
    );
  }

  /**
   * Creates a tag at a commit, annotated when a message is given.
   * @param name The tag name.
   * @param commit The commit to tag.
   * @param message The annotation message, or undefined for a lightweight tag.
   * @returns Returns the outcome.
   */
  public createTag(name: string, commit: string, message?: string): Promise<MutationResult> {
    return this.mutate(
      (api: SourceControlClient): Promise<GitRunResult> =>
        api.createTag(this.root, name, commit, message),
    );
  }

  /**
   * Deletes a local tag. Destructive; the caller confirms first.
   * @param name The tag name.
   * @returns Returns the outcome.
   */
  public deleteTag(name: string): Promise<MutationResult> {
    return this.mutate(
      (api: SourceControlClient): Promise<GitRunResult> => api.deleteTag(this.root, name),
    );
  }

  /**
   * Deletes a tag on a remote. Destructive for everyone who has fetched it, not just the caller.
   * @param remote The remote to delete on.
   * @param name The tag name.
   * @returns Returns the outcome.
   */
  public deleteRemoteTag(remote: string, name: string): Promise<MutationResult> {
    return this.mutate(
      (api: SourceControlClient): Promise<GitRunResult> =>
        api.deleteRemoteTag(this.root, remote, name),
    );
  }

  /**
   * Pushes one tag to a remote.
   * @param remote The remote to push to.
   * @param name The tag name.
   * @returns Returns the outcome.
   */
  public pushTag(remote: string, name: string): Promise<MutationResult> {
    return this.mutate(
      (api: SourceControlClient): Promise<GitRunResult> => api.pushTag(this.root, remote, name),
    );
  }

  /**
   * Pushes every local tag to a remote.
   * @param remote The remote to push to.
   * @returns Returns the outcome.
   */
  public pushAllTags(remote: string): Promise<MutationResult> {
    return this.mutate(
      (api: SourceControlClient): Promise<GitRunResult> => api.pushAllTags(this.root, remote),
    );
  }

  /**
   * Releases the repository in the main process.
   * @returns Returns a promise that resolves once the repository has been released.
   */
  public async close(): Promise<void> {
    await (this.api?.closeRepository(this.root) ?? Promise.resolve());
  }

  /**
   * Runs a mutating git bridge call, mapping its result to a {@link MutationResult}. Reports failure
   * when the bridge is absent.
   * @param call Invokes the desired bridge method.
   * @returns Returns the outcome.
   */
  private async mutate(
    call: (api: SourceControlClient) => Promise<GitRunResult>,
  ): Promise<MutationResult> {
    if (this.api === undefined) {
      return { success: false, error: 'Source control is unavailable' };
    }
    const result: GitRunResult = await call(this.api);
    return { success: result.success, error: result.error, code: result.code };
  }

  /**
   * Reads a blob's contents at a revision, returning an empty string when the bridge is absent or the
   * blob does not exist.
   * @param revision The revision to read at, or an empty string for the working tree.
   * @param filePath The repository-relative file path.
   * @returns Returns the blob contents.
   */
  private async blob(revision: string, filePath: string): Promise<string> {
    const result: GitRunResult | undefined = await this.api?.readBlob(
      this.root,
      revision,
      filePath,
    );
    return result?.success === true ? (result.stdout ?? '') : '';
  }

  /**
   * Runs a git bridge call, returning its standard output, or an empty string when the bridge is
   * absent or the command failed.
   * @param call Invokes the desired bridge method.
   * @returns Returns the command's standard output, or an empty string.
   */
  private async read(call: (api: SourceControlClient) => Promise<GitRunResult>): Promise<string> {
    if (this.api === undefined) {
      return '';
    }
    const result: GitRunResult = await call(this.api);
    return result.success ? (result.stdout ?? '') : '';
  }
}
