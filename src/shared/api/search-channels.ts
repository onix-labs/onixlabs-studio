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

  /**
   * Applies text edits to workspace files on disk — a rename's edits to the files no editor has open
   * (#1015) (renderer→main, invoke).
   */
  ApplyTextEdits = 'search:apply-text-edits',
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
 * One text edit to a file on disk: the span it replaces, one-based as the editor counts — columns in
 * UTF-16 code units, as a language server's are — and the text that replaces it.
 */
export interface DiskTextEdit {
  /**
   * Gets the line the span starts on.
   */
  readonly startLineNumber: number;

  /**
   * Gets the column the span starts at.
   */
  readonly startColumn: number;

  /**
   * Gets the line the span ends on.
   */
  readonly endLineNumber: number;

  /**
   * Gets the column the span ends at (exclusive).
   */
  readonly endColumn: number;

  /**
   * Gets the text that replaces the span.
   */
  readonly text: string;
}

/**
 * Names one file's edits in a {@link TextEditsRequest}.
 */
export interface DiskFileEdits {
  /**
   * Gets the absolute path of the file, which must lie inside an open workspace root.
   */
  readonly path: string;

  /**
   * Gets the edits, in any order; none may overlap another.
   */
  readonly edits: readonly DiskTextEdit[];
}

/**
 * Defines a request to apply text edits to workspace files on disk (#1015): the files a rename
 * changes that no editor has open. Each file is written whole or not at all.
 */
export interface TextEditsRequest {
  /**
   * Gets the files and their edits.
   */
  readonly files: readonly DiskFileEdits[];
}

/**
 * Names a file a {@link TextEditsRequest} wrote, and how many edits it took.
 */
export interface WrittenFile {
  /**
   * Gets the absolute path of the file, as the request named it.
   */
  readonly path: string;

  /**
   * Gets how many edits were applied to it.
   */
  readonly edits: number;
}

/**
 * Reports what a {@link TextEditsRequest} did.
 */
export interface TextEditsResponse {
  /**
   * Gets the files written.
   */
  readonly written: readonly WrittenFile[];

  /**
   * Gets the files that were not changed, each with its reason.
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

  /**
   * Gets the absolute paths of the files or folders to search, or undefined to search the whole root
   * (#1007: a project's folder for the Search panel's Current Project scope). Each must lie inside
   * {@link root}, as named and as resolved through any link; a request naming one that does not is
   * refused whole.
   */
  readonly paths?: readonly string[];
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

  /**
   * Applies text edits to workspace files on disk (#1015).
   * @param request The files and their edits.
   * @returns Returns the files written, and those that were not.
   */
  applyTextEdits(request: TextEditsRequest): Promise<TextEditsResponse>;
}
