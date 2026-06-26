import { GitCommit, GitFileChange, GitStash } from '../repository/repository-data';
import { ParsedRefs, ParsedStatus } from './git-output';

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
   * Releases the repository, freeing any backend resources.
   * @returns Returns a promise that resolves once the repository has been released.
   */
  close(): Promise<void>;
}
