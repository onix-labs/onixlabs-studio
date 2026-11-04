import type * as MonacoApi from 'monaco-editor';
import type {
  AutoCloseBrackets,
  AutoSurround,
  TextEditorSettings,
  UnusualLineTerminators,
} from '@shared/angular/services/settings/settings';

/**
 * Holds Monaco's `autoClosingBrackets` and `autoClosingQuotes` for each choice.
 */
const AUTO_CLOSE: Readonly<Record<AutoCloseBrackets, MonacoApi.editor.EditorAutoClosingStrategy>> =
  {
    always: 'always',
    'before-whitespace': 'beforeWhitespace',
    never: 'never',
  };

/**
 * Holds Monaco's `autoSurround` for each choice.
 */
const AUTO_SURROUND: Readonly<Record<AutoSurround, MonacoApi.editor.EditorAutoSurroundStrategy>> = {
  'brackets-and-quotes': 'languageDefined',
  brackets: 'brackets',
  quotes: 'quotes',
  never: 'never',
};

/**
 * Holds Monaco's `unusualLineTerminators` for each choice.
 */
const LINE_TERMINATORS: Readonly<
  Record<UnusualLineTerminators, MonacoApi.editor.IEditorOptions['unusualLineTerminators']>
> = {
  ask: 'prompt',
  remove: 'auto',
  ignore: 'off',
};

/**
 * Builds the Monaco options for how typing behaves, shared by the options an editor is created with
 * and the ones it re-applies when the settings change. Each is read per editor, none from the
 * configuration a Monaco instance shares, so a language's value stays with that language's editors.
 * @param resolved The code settings in force.
 * @returns Returns the options.
 */
export function editorTypingOptions(resolved: TextEditorSettings): MonacoApi.editor.IEditorOptions {
  return {
    autoClosingBrackets: AUTO_CLOSE[resolved.autoCloseBrackets],
    autoClosingQuotes: AUTO_CLOSE[resolved.autoCloseBrackets],
    autoSurround: AUTO_SURROUND[resolved.autoSurround],
    autoIndent: resolved.autoIndent,
    linkedEditing: resolved.linkedEditing,
    multiCursorModifier: resolved.multiCursorModifier === 'alt' ? 'alt' : 'ctrlCmd',
    unusualLineTerminators: LINE_TERMINATORS[resolved.unusualLineTerminators],
  };
}
