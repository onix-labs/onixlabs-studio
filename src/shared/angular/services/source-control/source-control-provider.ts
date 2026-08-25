import { GitCommit, GitFileChange, GitStash } from '../repository/repository-data';
import { ParsedRefs, ParsedStatus } from './git-output';

/**
 * Describes a push: which branch goes where, and whether the push claims the upstream.
 */
export interface PushTarget {
  /**
   * Gets the remote to push to.
   */
  readonly remote: string;

  /**
   * Gets the branch to push. Naming it is what allows a branch that is not checked out to be pushed.
   */
  readonly branch: string;

  /**
   * Gets a value indicating whether the push claims the upstream. True publishes a branch that has
   * none; false leaves an existing upstream alone, which must not be silently repointed.
   */
  readonly setUpstream: boolean;
}

/**
 * Describes the outcome of a mutating operation (stage, commit, …).
 */
export interface MutationResult {
  /**
   * Gets a value indicating whether the operation succeeded.
   */
  readonly success: boolean;

  /**
   * Gets the error message, when the operation failed.
   */
  readonly error?: string;

  /**
   * Gets a stable identifier for a failure the caller answers differently from any other. Present so
   * a caller never has to read git's prose to tell one refusal from another.
   */
  readonly code?: string;
}

/**
 * Holds the two sides of a file's diff.
 */
export interface FileDiff {
  /**
   * Gets the file's content before the change (the diff's original side).
   */
  readonly original: string;

  /**
   * Gets the file's content after the change (the diff's modified side).
   */
  readonly modified: string;
}

/**
 * Abstracts a version-control backend for a single opened repository. {@link GitProvider} is the first
 * implementation; other systems (for example SVN) would implement the same interface, so the
 * source-control surfaces (the repository tab and the workspace's lightweight integration) consume
 * any provider uniformly. The read-only operations of the first slice are defined here; mutating and
 * network operations are added in later slices.
 */
export interface SourceControlProvider {
  /**
   * Gets the repository's absolute root path.
   */
  readonly root: string;

  /**
   * Reads the working-tree status (branch, ahead/behind, staged, and unstaged changes).
   * @returns Returns the parsed status.
   */
  getStatus(): Promise<ParsedStatus>;

  /**
   * Reads the commit history (newest first) with parents and ref decorations.
   * @param limit The maximum number of commits to read.
   * @returns Returns the commits.
   */
  getCommits(limit: number): Promise<GitCommit[]>;

  /**
   * Reads the branches, remotes, and tags.
   * @returns Returns the parsed refs.
   */
  getRefs(): Promise<ParsedRefs>;

  /**
   * Reads the stash entries (newest first).
   * @returns Returns the stashes.
   */
  getStashes(): Promise<GitStash[]>;

  /**
   * Reads the files changed by a commit.
   * @param commit The commit to inspect.
   * @returns Returns the changed files.
   */
  getCommitFiles(commit: GitCommit): Promise<GitFileChange[]>;

  /**
   * Reads the two sides of a changed file's diff, resolving its revision context.
   * @param file The changed file.
   * @returns Returns the diff content.
   */
  getFileDiff(file: GitFileChange): Promise<FileDiff>;

  /**
   * Discards the uncommitted changes to paths: tracked files are restored to `HEAD` (index and
   * working tree), untracked files are deleted. Destructive; the caller confirms first.
   * @param paths The repository-relative paths to discard; must not be empty.
   * @returns Returns the outcome.
   */
  discard(paths: readonly string[]): Promise<MutationResult>;

  /**
   * Stages paths into the index, or the whole working tree when no paths are given.
   * @param paths The repository-relative paths to stage, or an empty array to stage everything.
   * @returns Returns the outcome.
   */
  stage(paths: readonly string[]): Promise<MutationResult>;

  /**
   * Unstages paths from the index, or the whole index when no paths are given.
   * @param paths The repository-relative paths to unstage, or an empty array to unstage everything.
   * @returns Returns the outcome.
   */
  unstage(paths: readonly string[]): Promise<MutationResult>;

  /**
   * Commits the staged changes with a message.
   * @param message The commit message.
   * @returns Returns the outcome.
   */
  commit(message: string): Promise<MutationResult>;

  /**
   * Stashes the working-tree changes.
   * @returns Returns the outcome.
   */
  stash(): Promise<MutationResult>;

  /**
   * Restores a stash onto the working tree, keeping it on the stack.
   * @param index The stack index of the stash (0 is the most recent).
   * @returns Returns the outcome.
   */
  applyStash(index: number): Promise<MutationResult>;

  /**
   * Restores a stash onto the working tree and drops it from the stack.
   * @param index The stack index of the stash (0 is the most recent).
   * @returns Returns the outcome.
   */
  popStash(index: number): Promise<MutationResult>;

  /**
   * Deletes a stash without restoring it. Destructive; the caller confirms first.
   * @param index The stack index of the stash (0 is the most recent).
   * @returns Returns the outcome.
   */
  dropStash(index: number): Promise<MutationResult>;

  /**
   * Checks out an existing branch.
   * @param branch The branch name.
   * @returns Returns the outcome.
   */
  checkout(branch: string): Promise<MutationResult>;

  /**
   * Creates a branch at the current head, optionally checking it out.
   * @param name The new branch name.
   * @param checkout Whether to check the new branch out.
   * @returns Returns the outcome.
   */
  createBranch(name: string, checkout: boolean): Promise<MutationResult>;

  /**
   * Fetches all remotes, pruning deleted remote-tracking branches.
   * @returns Returns the outcome.
   */
  fetch(): Promise<MutationResult>;

  /**
   * Fetches one ref from a remote into a local branch. Which ref carries a pull request's head is
   * the forge's convention rather than git's, so the source ref is supplied by the caller.
   * @param remote The remote to fetch from.
   * @param sourceRef The ref on the remote to fetch.
   * @param localBranch The local branch to create or update.
   * @returns Returns the outcome.
   */
  fetchRef(remote: string, sourceRef: string, localBranch: string): Promise<MutationResult>;

  /**
   * Pulls the current branch from its upstream.
   * @returns Returns the outcome.
   */
  pull(): Promise<MutationResult>;

  /**
   * Pushes a branch. Naming one is what allows a branch that is not checked out to be pushed; with no
   * target the checked-out branch goes to its configured upstream.
   * @param target The branch to push and where, or undefined to push the checked-out branch to its
   * existing upstream.
   * @returns Returns the outcome.
   */
  push(target?: PushTarget): Promise<MutationResult>;

  /**
   * Deletes a local branch. Destructive; the caller confirms first.
   * @param name The branch name.
   * @param force Whether to delete a branch whose commits are not merged anywhere.
   * @returns Returns the outcome, coded `branch-not-merged` when an unforced delete was refused
   * because the branch still holds commits of its own.
   */
  deleteBranch(name: string, force: boolean): Promise<MutationResult>;

  /**
   * Renames a local branch, including the checked-out one.
   * @param from The current branch name.
   * @param to The new branch name.
   * @returns Returns the outcome.
   */
  renameBranch(from: string, to: string): Promise<MutationResult>;

  /**
   * Points a local branch's upstream at a remote-tracking branch, or clears it.
   * @param branch The local branch.
   * @param upstream The remote-tracking branch to track, or null to clear the upstream.
   * @returns Returns the outcome.
   */
  setUpstream(branch: string, upstream: string | null): Promise<MutationResult>;

  /**
   * Fetches one remote, rather than all of them.
   * @param remote The remote to fetch.
   * @returns Returns the outcome.
   */
  fetchRemote(remote: string): Promise<MutationResult>;

  /**
   * Prunes one remote's tracking branches that no longer exist on it.
   * @param remote The remote to prune.
   * @returns Returns the outcome.
   */
  pruneRemote(remote: string): Promise<MutationResult>;

  /**
   * Adds a remote.
   * @param name The remote name.
   * @param url The remote URL.
   * @returns Returns the outcome.
   */
  addRemote(name: string, url: string): Promise<MutationResult>;

  /**
   * Removes a remote, along with its tracking branches. Destructive; the caller confirms first.
   * @param name The remote name.
   * @returns Returns the outcome.
   */
  removeRemote(name: string): Promise<MutationResult>;

  /**
   * Creates a local branch tracking a remote-tracking branch, and checks it out.
   * @param remoteBranch The remote-tracking branch, as `origin/main`.
   * @param localBranch The local branch to create.
   * @returns Returns the outcome.
   */
  checkoutTracking(remoteBranch: string, localBranch: string): Promise<MutationResult>;

  /**
   * Creates a tag at a commit, annotated when a message is given.
   * @param name The tag name.
   * @param commit The commit to tag.
   * @param message The annotation message, or undefined for a lightweight tag.
   * @returns Returns the outcome.
   */
  createTag(name: string, commit: string, message?: string): Promise<MutationResult>;

  /**
   * Deletes a local tag. Destructive; the caller confirms first.
   * @param name The tag name.
   * @returns Returns the outcome.
   */
  deleteTag(name: string): Promise<MutationResult>;

  /**
   * Deletes a tag on a remote. Destructive for everyone who has fetched it, not just the caller.
   * @param remote The remote to delete on.
   * @param name The tag name.
   * @returns Returns the outcome.
   */
  deleteRemoteTag(remote: string, name: string): Promise<MutationResult>;

  /**
   * Pushes one tag to a remote.
   * @param remote The remote to push to.
   * @param name The tag name.
   * @returns Returns the outcome.
   */
  pushTag(remote: string, name: string): Promise<MutationResult>;

  /**
   * Pushes every local tag to a remote.
   * @param remote The remote to push to.
   * @returns Returns the outcome.
   */
  pushAllTags(remote: string): Promise<MutationResult>;

  /**
   * Releases the repository, freeing any backend resources.
   * @returns Returns a promise that resolves once the repository has been released.
   */
  close(): Promise<void>;
}
