import { GitRunResult, SourceControlApi } from '../../../shared/studio-api';
import { GitCommit, GitFileChange, GitStash } from '../repository/repository-data';
import {
  ParsedRefs,
  ParsedStatus,
  parseCommitFiles,
  parseLog,
  parseRefs,
  parseStashes,
  parseStatus,
} from './git-output';
import { FileDiff, SourceControlProvider } from './source-control-provider';

/**
 * Holds the default number of commits the history loads.
 */
const DEFAULT_LOG_LIMIT: number = 500;

/**
 * The git implementation of {@link SourceControlProvider}. It calls the safe git bridge
 * (`window.studio.sourceControl`) for a single opened repository root and maps the raw output through
 * the {@link import('./git-output')} parsers into the application's source-control model. Running
 * outside Electron (no bridge) every read yields empty data, so the surfaces render their empty state
 * rather than throwing.
 */
export class GitProvider implements SourceControlProvider {
  /**
   * Holds the repository's absolute root path.
   */
  public readonly root: string;

  /**
   * Holds the git bridge, or undefined when running outside Electron.
   */
  private readonly api: SourceControlApi | undefined = window.studio?.sourceControl;

  /**
   * Initialises a new instance of the {@link GitProvider} class bound to a repository root.
   * @param root The repository's absolute root path.
   */
  public constructor(root: string) {
    this.root = root;
  }

  /**
   * Reads the working-tree status.
   * @returns Returns the parsed status.
   */
  public async getStatus(): Promise<ParsedStatus> {
    return parseStatus(
      await this.read((api: SourceControlApi): Promise<GitRunResult> => api.status(this.root)),
    );
  }

  /**
   * Reads the commit history.
   * @param limit The maximum number of commits to read.
   * @returns Returns the commits.
   */
  public async getCommits(limit: number = DEFAULT_LOG_LIMIT): Promise<GitCommit[]> {
    return parseLog(
      await this.read((api: SourceControlApi): Promise<GitRunResult> => api.log(this.root, limit)),
    );
  }

  /**
   * Reads the branches, remotes, and tags.
   * @returns Returns the parsed refs.
   */
  public async getRefs(): Promise<ParsedRefs> {
    return parseRefs(
      await this.read((api: SourceControlApi): Promise<GitRunResult> => api.refs(this.root)),
    );
  }

  /**
   * Reads the stash entries.
   * @returns Returns the stashes.
   */
  public async getStashes(): Promise<GitStash[]> {
    return parseStashes(
      await this.read((api: SourceControlApi): Promise<GitRunResult> => api.stashes(this.root)),
    );
  }

  /**
   * Reads the files changed by a commit, attaching each file's commit diff target.
   * @param commit The commit to inspect.
   * @returns Returns the changed files.
   */
  public async getCommitFiles(commit: GitCommit): Promise<GitFileChange[]> {
    const output: string = await this.read(
      (api: SourceControlApi): Promise<GitRunResult> => api.commitFiles(this.root, commit.hash),
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
        original: await this.blob('HEAD', newPath),
        modified: await this.blob(':', newPath),
      };
    }
    return { original: await this.blob(':', newPath), modified: await this.blob('', newPath) };
  }

  /**
   * Releases the repository in the main process.
   * @returns Returns a promise that resolves once the repository has been released.
   */
  public async close(): Promise<void> {
    await (this.api?.closeRepository(this.root) ?? Promise.resolve());
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
  private async read(call: (api: SourceControlApi) => Promise<GitRunResult>): Promise<string> {
    if (this.api === undefined) {
      return '';
    }
    const result: GitRunResult = await call(this.api);
    return result.success ? (result.stdout ?? '') : '';
  }
}
