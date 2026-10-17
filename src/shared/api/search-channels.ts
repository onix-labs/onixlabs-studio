/**
 * Names the workspace-search IPC channels. This is the search capability's slice of the IPC contract:
 * the renderer search client and the main-process search manager both name their channel from here,
 * over the generic {@link import('./bridge').Bridge} transport. Search runs in main because it shells
 * out to a bundled `ripgrep` binary the untrusted renderer must never invoke directly.
 */
export enum SearchChannel {
  /**
   * Runs a workspace search and returns the grouped matches (renderer→main, invoke).
   */
  Run = 'search:run',

  /**
   * Lists a workspace root's files (gitignore-aware relative paths, capped), for the composer's
   * `@`-mention picker (renderer→main, invoke).
   */
  ListFiles = 'search:list-files',

  /**
   * Replaces matches of a query in a workspace's files on disk (renderer→main, invoke).
   */
  Replace = 'search:replace',
}

/**
 * Names the one match a single Replace changes: where ripgrep reported it.
 */
export interface ReplaceTarget {
  /**
   * Gets the absolute path of the file holding the match.
   */
  readonly path: string;

  /**
   * Gets the one-based line of the match.
   */
  readonly line: number;

  /**
   * Gets the one-based column of the match, as ripgrep reports it: its byte offset into the line, plus
   * one.
   */
  readonly column: number;
}

/**
 * Defines a request to replace matches of a query in a workspace's files.
 *
 * Either {@link target} names the one match to change (Replace), or it is absent and every match of the
 * query in each of {@link files} is changed (Replace All). Replace All re-reads each file rather than
 * trusting the results list, because ripgrep lists only the first match on a line.
 */
export interface ReplaceRequest {
  /**
   * Gets the text (or, when {@link regexp} is set, the pattern) to replace.
   */
  readonly query: string;

  /**
   * Gets the absolute path of the workspace root the files lie in; must be an open workspace root.
   */
  readonly root: string;

  /**
   * Gets a value indicating whether the match is case-sensitive.
   */
  readonly caseSensitive: boolean;

  /**
   * Gets a value indicating whether only whole words match.
   */
  readonly wholeWord: boolean;

  /**
   * Gets a value indicating whether {@link query} is a regular expression. When it is, the replacement
   * may name the pattern's groups (`$1`, `$<name>`); otherwise it is taken literally.
   */
  readonly regexp: boolean;

  /**
   * Gets the text each match is replaced with.
   */
  readonly replacement: string;

  /**
   * Gets the absolute paths of the files to replace in.
   */
  readonly files: readonly string[];

  /**
   * Gets the one match to replace, or undefined to replace every match in {@link files}.
   */
  readonly target?: ReplaceTarget;
}

/**
 * Names a file a replace could not change, and why.
 */
export interface ReplaceFailure {
  /**
   * Gets the absolute path of the file.
   */
  readonly path: string;

  /**
   * Gets the reason, for the user.
   */
  readonly reason: string;
}

/**
 * Reports what a replace did.
 */
export interface ReplaceResponse {
  /**
   * Gets how many matches were replaced.
   */
  readonly replaced: number;

  /**
   * Gets how many files were written.
   */
  readonly files: number;

  /**
   * Gets the files that could not be changed, each with its reason.
   */
  readonly failed: readonly ReplaceFailure[];
}

/**
 * Defines a request to search a workspace root for a query.
 */
export interface SearchRequest {
  /**
   * Gets the text (or, when {@link regexp} is set, the pattern) to search for.
   */
  readonly query: string;

  /**
   * Gets the absolute path of the workspace root to search; must be an open workspace root.
   */
  readonly root: string;

  /**
   * Gets a value indicating whether the search is case-sensitive.
   */
  readonly caseSensitive: boolean;

  /**
   * Gets a value indicating whether the search matches whole words only.
   */
  readonly wholeWord: boolean;

  /**
   * Gets a value indicating whether {@link query} is a regular-expression pattern.
   */
  readonly regexp: boolean;
}

/**
 * Describes a single match within a file: its one-based line and column and the text of the line it
 * occurs on, for preview in the results tree.
 */
export interface SearchMatch {
  /**
   * Gets the one-based line number of the match.
   */
  readonly line: number;

  /**
   * Gets the one-based column at which the match begins.
   */
  readonly column: number;

  /**
   * Gets the line text before the match, trimmed to a preview length.
   */
  readonly before: string;

  /**
   * Gets the matched text.
   */
  readonly text: string;

  /**
   * Gets the line text after the match, trimmed to a preview length.
   */
  readonly after: string;
}

/**
 * Describes all matches within a single file.
 */
export interface SearchResultFile {
  /**
   * Gets the absolute path of the file.
   */
  readonly path: string;

  /**
   * Gets the file's path relative to the searched workspace root, for display.
   */
  readonly relativePath: string;

  /**
   * Gets the matches within the file, in document order.
   */
  readonly matches: readonly SearchMatch[];
}

/**
 * Defines the response to a {@link SearchRequest}: the matched files, the total match count, and
 * whether the results were capped.
 */
export interface SearchResponse {
  /**
   * Gets the matched files, in the order ripgrep returned them.
   */
  readonly files: readonly SearchResultFile[];

  /**
   * Gets the total number of matches across every file.
   */
  readonly total: number;

  /**
   * Gets a value indicating whether the results were truncated at the match cap.
   */
  readonly capped: boolean;
}

/**
 * Defines the renderer-facing search operations, wrapping the {@link SearchChannel} transport.
 */
export interface SearchClient {
  /**
   * Runs a workspace search.
   * @param request The search request.
   * @returns Returns the grouped matches.
   */
  run(request: SearchRequest): Promise<SearchResponse>;

  /**
   * Lists a workspace root's files as gitignore-aware relative paths, capped.
   * @param root The absolute path of the workspace root; must be an open workspace root.
   * @returns Returns the relative paths (empty for an unknown root).
   */
  listFiles(root: string): Promise<readonly string[]>;

  /**
   * Replaces matches of a query in a workspace's files on disk.
   * @param request The replace request.
   * @returns Returns what was replaced, and what could not be.
   */
  replace(request: ReplaceRequest): Promise<ReplaceResponse>;
}
