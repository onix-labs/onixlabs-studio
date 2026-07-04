/**
 * Specifies the kind of reference a {@link GitRef} names.
 */
export type GitRefKind = 'head' | 'branch' | 'remote' | 'tag';

/**
 * Names a reference (the current head, a local branch, a remote-tracking branch, or a tag) that
 * points at a commit, shown as a badge in the graph.
 */
export interface GitRef {
  /**
   * Gets the reference name (for example `main` or `v0.5.0`).
   */
  readonly name: string;

  /**
   * Gets the kind of reference.
   */
  readonly kind: GitRefKind;
}

/**
 * Specifies how a file changed relative to its parent.
 */
export type GitChangeStatus = 'added' | 'modified' | 'deleted' | 'renamed';

/**
 * Maps a change status to its single-letter badge (A, M, D, R).
 * @param status The change status.
 * @returns Returns the status letter.
 */
export function statusLetter(status: GitChangeStatus): string {
  switch (status) {
    case 'added':
      return 'A';
    case 'deleted':
      return 'D';
    case 'renamed':
      return 'R';
    default:
      return 'M';
  }
}

/**
 * Identifies the revision context a real file change is diffed against, so its before/after contents
 * can be loaded lazily from the provider. Mock changes embed their contents directly and omit this.
 */
export type DiffTarget =
  | {
      /**
       * Marks the change as belonging to a commit.
       */
      readonly kind: 'commit';

      /**
       * Gets the commit hash the file changed in.
       */
      readonly hash: string;

      /**
       * Gets the first-parent hash to diff against, or null for a root commit.
       */
      readonly parent: string | null;
    }
  | {
      /**
       * Marks the change as belonging to the working tree.
       */
      readonly kind: 'working';

      /**
       * Gets a value indicating whether the change is staged (index) rather than unstaged (worktree).
       */
      readonly staged: boolean;
    };

/**
 * Describes a single changed file: its path, how it changed, the line tallies, and the before/after
 * content the Monaco diff surface compares.
 */
export interface GitFileChange {
  /**
   * Gets the file path relative to the repository root.
   */
  readonly path: string;

  /**
   * Gets the previous path when the file was renamed.
   */
  readonly previousPath?: string;

  /**
   * Gets how the file changed.
   */
  readonly status: GitChangeStatus;

  /**
   * Gets the number of added lines.
   */
  readonly additions: number;

  /**
   * Gets the number of removed lines.
   */
  readonly deletions: number;

  /**
   * Gets the Monaco language identifier used to syntax-highlight the diff.
   */
  readonly language: string;

  /**
   * Gets the file's content before the change (the diff's original side). Empty for an added file.
   */
  readonly original: string;

  /**
   * Gets the file's content after the change (the diff's modified side). Empty for a deleted file.
   */
  readonly modified: string;

  /**
   * Gets the revision context the change is diffed against, when its contents are loaded lazily from
   * a provider. Omitted for mock changes, which embed {@link original} and {@link modified} directly.
   */
  readonly target?: DiffTarget;
}

/**
 * Describes a single commit in the history.
 */
export interface GitCommit {
  /**
   * Gets the full commit hash.
   */
  readonly hash: string;

  /**
   * Gets the abbreviated commit hash.
   */
  readonly shortHash: string;

  /**
   * Gets the first line of the commit message.
   */
  readonly summary: string;

  /**
   * Gets the remainder of the commit message, or an empty string when there is none.
   */
  readonly body: string;

  /**
   * Gets the author's name.
   */
  readonly author: string;

  /**
   * Gets the author's email.
   */
  readonly email: string;

  /**
   * Gets a human-readable relative date (for example `2 days ago`).
   */
  readonly relativeDate: string;

  /**
   * Gets the absolute date label.
   */
  readonly isoDate: string;

  /**
   * Gets the parent commit hashes; more than one denotes a merge.
   */
  readonly parents: readonly string[];

  /**
   * Gets the references that point at this commit.
   */
  readonly refs: readonly GitRef[];

  /**
   * Gets the files changed by this commit.
   */
  readonly files: readonly GitFileChange[];
}

/**
 * Describes a local branch and its divergence from its upstream.
 */
export interface GitBranch {
  /**
   * Gets the branch name.
   */
  readonly name: string;

  /**
   * Gets a value indicating whether this is the checked-out branch.
   */
  readonly current: boolean;

  /**
   * Gets the upstream branch name, or undefined when the branch has no upstream.
   */
  readonly upstream?: string;

  /**
   * Gets the number of commits ahead of the upstream.
   */
  readonly ahead: number;

  /**
   * Gets the number of commits behind the upstream.
   */
  readonly behind: number;

  /**
   * Gets the hash of the branch's tip commit.
   */
  readonly tip: string;
}

/**
 * Describes a configured remote.
 */
export interface GitRemote {
  /**
   * Gets the remote name.
   */
  readonly name: string;

  /**
   * Gets the remote URL.
   */
  readonly url: string;

  /**
   * Gets the remote-tracking branch names.
   */
  readonly branches: readonly string[];
}

/**
 * Describes a tag.
 */
export interface GitTag {
  /**
   * Gets the tag name.
   */
  readonly name: string;

  /**
   * Gets the hash of the commit the tag points at.
   */
  readonly commit: string;
}

/**
 * Describes a stash entry.
 */
export interface GitStash {
  /**
   * Gets the stack index (0 is the most recent).
   */
  readonly index: number;

  /**
   * Gets the stash message.
   */
  readonly message: string;

  /**
   * Gets the branch the stash was taken from.
   */
  readonly branch: string;

  /**
   * Gets the files captured by the stash.
   */
  readonly files: readonly GitFileChange[];
}

/**
 * Represents one row of the commit graph: a commit (or the synthetic working-tree node) resolved to a
 * lane, a colour, and the edges that connect it down to its parents.
 */
export interface GraphNode {
  /**
   * Gets the node identifier (a commit hash, or the working-tree sentinel).
   */
  readonly id: string;

  /**
   * Gets the node kind.
   */
  readonly kind: 'commit' | 'working';

  /**
   * Gets the zero-based row index.
   */
  readonly row: number;

  /**
   * Gets the zero-based lane (graph column) the node's dot sits in.
   */
  readonly lane: number;

  /**
   * Gets the lane colour.
   */
  readonly color: string;

  /**
   * Gets the backing commit, or null for the working-tree node.
   */
  readonly commit: GitCommit | null;

  /**
   * Gets the references that point at this node.
   */
  readonly refs: readonly GitRef[];

  /**
   * Gets the edges descending from this node to each of its parents.
   */
  readonly edges: readonly {
    /**
     * Gets the parent's row index.
     */
    readonly toRow: number;

    /**
     * Gets the parent's lane.
     */
    readonly toLane: number;

    /**
     * Gets the edge colour (the parent lane's colour).
     */
    readonly color: string;
  }[];
}
