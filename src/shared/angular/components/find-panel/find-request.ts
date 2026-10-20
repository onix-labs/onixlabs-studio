/**
 * Where a find looks (#1007): the files on disk across the workspace or the active file's project, or
 * the open editors' contents — every open file, the active one, or the selection in it.
 */
export type FindScope = 'workspace' | 'project' | 'open-files' | 'file' | 'selection';

/**
 * Whether a find opens to find only, or to find and replace.
 */
export type FindMode = 'find' | 'replace';

/**
 * Describes a range in an editor, one-based and inclusive of its start, as Monaco counts.
 */
export interface FindRange {
  /**
   * Gets the line the range starts on.
   */
  readonly startLineNumber: number;

  /**
   * Gets the column the range starts at.
   */
  readonly startColumn: number;

  /**
   * Gets the line the range ends on.
   */
  readonly endLineNumber: number;

  /**
   * Gets the column the range ends at.
   */
  readonly endColumn: number;
}

/**
 * Asks for a find to open (#1007): from ⌘F / ⌘⌥F in an editor, a strip's Find button or a menu item.
 * Studio's Search panel answers it inside a workspace; the tab's own Find panel answers it elsewhere.
 * Monaco's find widget never does.
 */
export interface FindRequest {
  /**
   * Gets whether to open for find or for replace.
   */
  readonly mode: FindMode;

  /**
   * Gets where to look.
   */
  readonly scope: FindScope;

  /**
   * Gets the text to search for, usually the selection, or undefined to keep what the panel holds.
   */
  readonly seed?: string;

  /**
   * Gets the absolute path of the file the request came from, or null for an editor with no file
   * (an untitled document, a request body).
   */
  readonly filePath?: string | null;

  /**
   * Gets the selection when the request was made — snapshotted, because choosing a result moves the
   * caret — or null when nothing was selected.
   */
  readonly selection?: FindRange | null;
}
