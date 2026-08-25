// The version-control (git) capability's slice of the IPC contract. The renderer's SourceControl
// client and the main-process GitManager both name their channels from here, carried over the generic
// window.bridge transport. The git CLI is invoked in the main process with array arguments (never a
// shell), its variable arguments validated, and every operation confined to a repository root the user
// has explicitly opened — the renderer is treated as hostile. Output is returned raw for the renderer's
// source-control provider to parse and map.

/**
 * Names the version-control IPC channels. Every operation is a request/response `invoke`.
 */
export enum SourceControlChannel {
  /**
   * Shows an open-folder dialog and resolves the chosen folder's enclosing git repository root.
   */
  OpenRepository = 'source-control:open-repository',

  /**
   * Resolves the git repository root that contains an already-open folder, without a dialog.
   */
  ResolveRepository = 'source-control:resolve-repository',

  /**
   * Releases an open repository root, removing it from the set git operations are confined to.
   */
  CloseRepository = 'source-control:close-repository',

  /**
   * Reads the working-tree status of a repository (porcelain v2, with the branch header).
   */
  Status = 'source-control:status',

  /**
   * Reads the commit history of a repository, with parent hashes and ref decorations.
   */
  Log = 'source-control:log',

  /**
   * Reads the branches and tags of a repository (local heads, remote-tracking heads, and tags).
   */
  Refs = 'source-control:refs',

  /**
   * Reads the configured remotes of a repository with their URLs (`git remote -v`). Separate from
   * {@link Refs}, which reads remote-tracking *branches* and so knows nothing of a remote's URL — nor
   * of a remote that has never been fetched.
   */
  Remotes = 'source-control:remotes',

  /**
   * Reads the stash entries of a repository.
   */
  Stashes = 'source-control:stashes',

  /**
   * Reads the files changed by a single commit (name-status against its first parent).
   */
  CommitFiles = 'source-control:commit-files',

  /**
   * Reads the contents of a file at a revision for one side of a diff.
   */
  ReadBlob = 'source-control:read-blob',

  /**
   * Discards the uncommitted changes to files: tracked files are restored to `HEAD`, untracked
   * files are deleted. Destructive; the caller confirms first.
   */
  Discard = 'source-control:discard',

  /**
   * Stages files into the index, or the whole working tree when no paths are given.
   */
  Stage = 'source-control:stage',

  /**
   * Unstages files from the index, or the whole index when no paths are given.
   */
  Unstage = 'source-control:unstage',

  /**
   * Commits the staged changes with a message.
   */
  Commit = 'source-control:commit',

  /**
   * Stashes the working-tree changes.
   */
  Stash = 'source-control:stash',

  /**
   * Restores a stash onto the working tree, keeping it on the stack.
   */
  StashApply = 'source-control:stash-apply',

  /**
   * Restores a stash onto the working tree and drops it from the stack.
   */
  StashPop = 'source-control:stash-pop',

  /**
   * Deletes a stash without restoring it. Destructive; the caller confirms first.
   */
  StashDrop = 'source-control:stash-drop',

  /**
   * Checks out an existing branch.
   */
  Checkout = 'source-control:checkout',

  /**
   * Creates a branch at the current head, optionally checking it out.
   */
  CreateBranch = 'source-control:create-branch',

  /**
   * Fetches all remotes, pruning deleted remote-tracking branches.
   */
  Fetch = 'source-control:fetch',

  /**
   * Fetches one ref from a remote into a local branch. The caller supplies the source ref, because
   * which ref carries a pull request's head is the forge's convention rather than git's — GitHub
   * publishes `refs/pull/N/head`, and another forge names it differently.
   */
  FetchRef = 'source-control:fetch-ref',

  /**
   * Pulls the current branch from its upstream.
   */
  Pull = 'source-control:pull',

  /**
   * Pushes the current branch, optionally setting the upstream on the push.
   */
  Push = 'source-control:push',

  /**
   * Creates a tag at a commit, annotated when a message is given.
   */
  CreateTag = 'source-control:create-tag',

  /**
   * Deletes a local tag. Destructive; the caller confirms first.
   */
  DeleteTag = 'source-control:delete-tag',

  /**
   * Deletes a tag on a remote. Destructive for everyone who has fetched it, not just the caller.
   */
  DeleteRemoteTag = 'source-control:delete-remote-tag',

  /**
   * Pushes one tag to a remote.
   */
  PushTag = 'source-control:push-tag',

  /**
   * Pushes every local tag to a remote.
   */
  PushAllTags = 'source-control:push-all-tags',
}

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
 * Defines the renderer-facing version-control operations, each mapping to a {@link SourceControlChannel}
 * over the bridge. The shape the renderer's source-control provider consumes.
 */
export interface SourceControlClient {
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
   * Reads the configured remotes of a repository with their URLs.
   * @param root The absolute repository root; must be an open root.
   * @returns Returns the raw command result.
   */
  remotes(root: string): Promise<GitRunResult>;

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
   * Discards the uncommitted changes to files: tracked files are restored to `HEAD` (index and
   * working tree), untracked files are deleted from disk. Destructive; the caller confirms first.
   * @param root The absolute repository root; must be an open root.
   * @param paths The repository-relative paths to discard; must not be empty.
   * @returns Returns the raw command result.
   */
  discard(root: string, paths: readonly string[]): Promise<GitRunResult>;

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
   * Restores a stash onto the working tree, keeping it on the stack.
   * @param root The absolute repository root; must be an open root.
   * @param index The stack index of the stash (0 is the most recent).
   * @returns Returns the raw command result.
   */
  stashApply(root: string, index: number): Promise<GitRunResult>;

  /**
   * Restores a stash onto the working tree and drops it from the stack.
   * @param root The absolute repository root; must be an open root.
   * @param index The stack index of the stash (0 is the most recent).
   * @returns Returns the raw command result.
   */
  stashPop(root: string, index: number): Promise<GitRunResult>;

  /**
   * Deletes a stash without restoring it. Destructive; the caller confirms first.
   * @param root The absolute repository root; must be an open root.
   * @param index The stack index of the stash (0 is the most recent).
   * @returns Returns the raw command result.
   */
  stashDrop(root: string, index: number): Promise<GitRunResult>;

  /**
   * Checks out an existing branch.
   * @param root The absolute repository root; must be an open root.
   * @param branch The branch name to check out.
   * @returns Returns the raw command result.
   */
  checkout(root: string, branch: string): Promise<GitRunResult>;

  /**
   * Creates a branch at the current head, optionally checking it out.
   * @param root The absolute repository root; must be an open root.
   * @param name The new branch name.
   * @param checkout Whether to check the new branch out; when false the branch is created and the
   * current one stays checked out.
   * @returns Returns the raw command result.
   */
  createBranch(root: string, name: string, checkout: boolean): Promise<GitRunResult>;

  /**
   * Fetches all remotes, pruning deleted remote-tracking branches.
   * @param root The absolute repository root; must be an open root.
   * @returns Returns the raw command result.
   */
  fetch(root: string): Promise<GitRunResult>;

  /**
   * Fetches one ref from a remote into a local branch.
   * @param root The absolute repository root; must be an open root.
   * @param remote The remote to fetch from.
   * @param sourceRef The ref on the remote to fetch (for example `refs/pull/7/head`).
   * @param localBranch The local branch to create or update.
   * @returns Returns the raw command result.
   */
  fetchRef(
    root: string,
    remote: string,
    sourceRef: string,
    localBranch: string,
  ): Promise<GitRunResult>;

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

  /**
   * Creates a tag at a commit. A message makes it annotated — which is what a release wants, since an
   * annotated tag is an object in its own right carrying its author, date and message.
   * @param root The absolute repository root; must be an open root.
   * @param name The tag name.
   * @param commit The commit to tag.
   * @param message The annotation message, or undefined for a lightweight tag.
   * @returns Returns the raw command result.
   */
  createTag(root: string, name: string, commit: string, message?: string): Promise<GitRunResult>;

  /**
   * Deletes a local tag. Destructive; the caller confirms first.
   * @param root The absolute repository root; must be an open root.
   * @param name The tag name.
   * @returns Returns the raw command result.
   */
  deleteTag(root: string, name: string): Promise<GitRunResult>;

  /**
   * Deletes a tag on a remote. Destructive for everyone who has fetched it, not just the caller.
   * @param root The absolute repository root; must be an open root.
   * @param remote The remote to delete on.
   * @param name The tag name.
   * @returns Returns the raw command result.
   */
  deleteRemoteTag(root: string, remote: string, name: string): Promise<GitRunResult>;

  /**
   * Pushes one tag to a remote.
   * @param root The absolute repository root; must be an open root.
   * @param remote The remote to push to.
   * @param name The tag name.
   * @returns Returns the raw command result.
   */
  pushTag(root: string, remote: string, name: string): Promise<GitRunResult>;

  /**
   * Pushes every local tag to a remote.
   * @param root The absolute repository root; must be an open root.
   * @param remote The remote to push to.
   * @returns Returns the raw command result.
   */
  pushAllTags(root: string, remote: string): Promise<GitRunResult>;
}
