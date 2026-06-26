import { GitCommit, GitFileChange, GitStash } from '../repository/repository-data';
import { ParsedRefs, ParsedStatus } from './git-output';

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
   * Checks out an existing branch.
   * @param branch The branch name.
   * @returns Returns the outcome.
   */
  checkout(branch: string): Promise<MutationResult>;

  /**
   * Creates a branch at the current head and checks it out.
   * @param name The new branch name.
   * @returns Returns the outcome.
   */
  createBranch(name: string): Promise<MutationResult>;

  /**
   * Releases the repository, freeing any backend resources.
   * @returns Returns a promise that resolves once the repository has been released.
   */
  close(): Promise<void>;
}
