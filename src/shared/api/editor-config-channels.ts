/**
 * Names the EditorConfig IPC channels. Resolving a file's `.editorconfig` walks its parent folders, so
 * it runs in the main process; the renderer asks over the generic
 * {@link import('./bridge').Bridge} transport.
 */
export enum EditorConfigChannel {
  /**
   * Resolves the EditorConfig properties of a file (renderer→main, invoke).
   */
  Resolve = 'editor-config:resolve',
}

/**
 * Names a line ending an `.editorconfig` can ask for.
 */
export type EditorConfigEndOfLine = 'lf' | 'crlf' | 'cr';

/**
 * Names a character set an `.editorconfig` can ask for.
 */
export type EditorConfigCharset = 'latin1' | 'utf-8' | 'utf-8-bom' | 'utf-16be' | 'utf-16le';

/**
 * Describes what the `.editorconfig` files covering a file say about it. A property they do not set,
 * or `unset`, is absent, which leaves Studio's own setting in force.
 */
export interface EditorConfigProperties {
  /**
   * Gets whether indentation uses tabs or spaces.
   */
  readonly indentStyle?: 'tab' | 'space';

  /**
   * Gets the columns of one indentation level, or `tab` to use {@link tabWidth}.
   */
  readonly indentSize?: number | 'tab';

  /**
   * Gets the columns a tab character occupies.
   */
  readonly tabWidth?: number;

  /**
   * Gets the line ending.
   */
  readonly endOfLine?: EditorConfigEndOfLine;

  /**
   * Gets the character set.
   */
  readonly charset?: EditorConfigCharset;

  /**
   * Gets whether trailing whitespace is removed on save: true removes it, false keeps it.
   */
  readonly trimTrailingWhitespace?: boolean;

  /**
   * Gets whether a saved file ends with a newline: true ensures one, false ensures none.
   */
  readonly insertFinalNewline?: boolean;

  /**
   * Gets the column a ruler is drawn at, or `off` for no ruler.
   */
  readonly maxLineLength?: number | 'off';
}

/**
 * Describes the outcome of resolving a file's EditorConfig.
 */
export interface EditorConfigResolution {
  /**
   * Gets the properties in force for the file.
   */
  readonly properties: EditorConfigProperties;

  /**
   * Gets every `.editorconfig` path that decides them, whether or not it exists yet: creating one
   * changes the answer as surely as editing one does.
   */
  readonly candidates: readonly string[];
}

/**
 * Holds the resolution of a file no `.editorconfig` speaks for.
 */
export const NO_EDITOR_CONFIG: EditorConfigResolution = { properties: {}, candidates: [] };
