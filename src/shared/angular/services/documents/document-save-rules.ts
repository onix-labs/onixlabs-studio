import type { EditorConfigProperties } from '@shared/api/editor-config-channels';
import type { TextEditorSettings } from '@shared/angular/services/settings/settings';

/**
 * Readies an open document for saving, in its editor: what only an editor can do, such as formatting.
 * Returns the code settings in force and the text last saved, which Changed Lines Only compares with.
 */
export type DocumentSavePreparer = (
  settings: TextEditorSettings,
  savedContent: string,
) => Promise<void>;

/**
 * Describes what happens to a document's text as it is written. The one place a save changes text, so
 * what asks for a change (EditorConfig, a setting) only has to say which rules are in force.
 */
export interface DocumentSaveRules {
  /**
   * Gets whether whitespace at the end of each line is removed.
   */
  readonly trimTrailingWhitespace: boolean;

  /**
   * Gets what is done to the end of the text: `insert` ensures a final newline, `remove` ensures
   * none, and `keep` leaves it alone.
   */
  readonly finalNewline: 'insert' | 'remove' | 'keep';

  /**
   * Gets whether blank lines after the last line of text are removed, leaving its own newline.
   */
  readonly trimFinalNewlines: boolean;

  /**
   * Gets the line ending every line is converted to, or null to leave them alone.
   */
  readonly endOfLine: 'LF' | 'CRLF' | null;
}

/**
 * Holds the rules that leave a document's text exactly as it is.
 */
export const NO_SAVE_RULES: DocumentSaveRules = {
  trimTrailingWhitespace: false,
  finalNewline: 'keep',
  trimFinalNewlines: false,
  endOfLine: null,
};

/**
 * Reads the save rules an `.editorconfig` asks for. Monaco has no bare CR line ending, so
 * `end_of_line = cr` leaves line endings alone.
 * @param properties The properties in force, or null when none are.
 * @returns Returns the rules.
 */
export function saveRulesFromEditorConfig(
  properties: EditorConfigProperties | null,
): DocumentSaveRules {
  const finalNewline: boolean | undefined = properties?.insertFinalNewline;
  const endOfLine: string | undefined = properties?.endOfLine;
  return {
    trimTrailingWhitespace: properties?.trimTrailingWhitespace === true,
    finalNewline: finalNewline === undefined ? 'keep' : finalNewline ? 'insert' : 'remove',
    trimFinalNewlines: false,
    endOfLine: endOfLine === 'lf' ? 'LF' : endOfLine === 'crlf' ? 'CRLF' : null,
  };
}

/**
 * Reads the save rules in force: an `.editorconfig` decides what it states, and the code settings
 * decide the rest.
 * @param properties The properties in force, or null when none are.
 * @param settings The code settings for the document's language.
 * @returns Returns the rules.
 */
export function resolveSaveRules(
  properties: EditorConfigProperties | null,
  settings: TextEditorSettings,
): DocumentSaveRules {
  const stated: DocumentSaveRules = saveRulesFromEditorConfig(properties);
  return {
    ...stated,
    trimTrailingWhitespace: properties?.trimTrailingWhitespace ?? settings.trimTrailingWhitespace,
    finalNewline:
      stated.finalNewline === 'keep' && settings.insertFinalNewline
        ? 'insert'
        : stated.finalNewline,
    trimFinalNewlines: settings.trimFinalNewlines && stated.finalNewline !== 'remove',
  };
}

/**
 * Narrows save rules for an Auto Save made while the user is typing: nothing may change the text under
 * the caret, so only the line endings, which it cannot see, still apply.
 * @param rules The rules in force.
 * @returns Returns the rules to save under.
 */
export function saveRulesWhileTyping(rules: DocumentSaveRules): DocumentSaveRules {
  return { ...NO_SAVE_RULES, endOfLine: rules.endOfLine };
}

/**
 * Applies save rules to a document's text.
 * @param text The text.
 * @param rules The rules.
 * @returns Returns the text to write: the very same string when the rules change nothing.
 */
export function applySaveRules(text: string, rules: DocumentSaveRules): string {
  let result: string = text;
  if (rules.trimTrailingWhitespace) {
    result = result.replace(/[ \t]+(?=\r?\n|$)/g, '');
  }
  if (rules.trimFinalNewlines) {
    result = result.replace(/(\r?\n)(?:\r?\n)+$/, '$1');
  }
  if (rules.finalNewline === 'remove') {
    result = result.replace(/(?:\r?\n)+$/, '');
  } else if (rules.finalNewline === 'insert' && result.length > 0 && !result.endsWith('\n')) {
    result += rules.endOfLine === 'CRLF' || result.includes('\r\n') ? '\r\n' : '\n';
  }
  if (rules.endOfLine !== null) {
    result = result.replace(/\r?\n/g, rules.endOfLine === 'CRLF' ? '\r\n' : '\n');
  }
  return result;
}
