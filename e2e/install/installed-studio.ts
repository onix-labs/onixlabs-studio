/**
 * An installed copy of Studio, as the install gate starts it.
 */
export interface InstalledStudio {
  /**
   * Gets the path a user's launcher starts.
   */
  readonly executable: string;

  /**
   * Gets the directory the installation occupies, for the evidence.
   */
  readonly installRoot: string;
}
