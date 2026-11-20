/**
 * Describes a JSON file as a dynamic import yields it: its parsed content, as yet unchecked.
 */
export interface JsonModule {
  /**
   * Gets the file's parsed content.
   */
  readonly default: unknown;
}
