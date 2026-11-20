/**
 * Describes a translation file as `ng extract-i18n --format json` writes it, and as the translators'
 * copies of it keep it: the locale, and each message's text by its id.
 */
export interface TranslationFile {
  /**
   * Gets the locale the messages are written in.
   */
  readonly locale: string;

  /**
   * Gets each message's text, by message id.
   */
  readonly translations: Readonly<Record<string, string>>;
}
