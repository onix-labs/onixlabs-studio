/**
 * What the Remember Language modal offers after the user changes a file's language by hand (#1068).
 */
export interface RememberLanguageOffer {
  /**
   * Gets the identifier of the document whose language changed.
   */
  readonly documentId: string;

  /**
   * Gets the file's path, which a "this file" answer remembers.
   */
  readonly path: string;

  /**
   * Gets the file's name, as the question shows it.
   */
  readonly fileName: string;

  /**
   * Gets the Monaco language identifier chosen.
   */
  readonly language: string;

  /**
   * Gets the chosen language's display name, as the question shows it.
   */
  readonly languageName: string;

  /**
   * Gets the pattern every file with the same ending matches, such as `*.foo`, or undefined for a
   * file with no ending, which is offered "this file" only.
   */
  readonly extensionPattern: string | undefined;
}
