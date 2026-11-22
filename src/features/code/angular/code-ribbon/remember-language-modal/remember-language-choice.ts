/**
 * How the user answers the Remember Language modal (#1068).
 */
export enum RememberLanguageChoice {
  /**
   * Remember the language for this one file, by its path.
   */
  ThisFile = 'this-file',

  /**
   * Remember it for every file with the same ending.
   */
  Extension = 'extension',

  /**
   * Remember nothing: the change holds for this tab only.
   */
  None = 'none',
}
