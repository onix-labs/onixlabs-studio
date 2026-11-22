/**
 * Describes a merged branch Delete Merged Branches could not delete, and why (#887).
 */
export interface MergedBranchFailure {
  /**
   * Gets the local branch's name.
   */
  readonly name: string;

  /**
   * Gets what went wrong, as the plugin said it.
   */
  readonly error: string;
}

/**
 * Describes what Delete Merged Branches did (#887).
 */
export interface MergedBranchesDeletion {
  /**
   * Gets the local branches deleted.
   */
  readonly deleted: readonly string[];

  /**
   * Gets the remote branches deleted, as `origin/feature`.
   */
  readonly deletedOnRemote: readonly string[];

  /**
   * Gets the branches left standing, with why.
   */
  readonly failed: readonly MergedBranchFailure[];
}
