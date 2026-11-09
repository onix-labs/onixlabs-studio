import type * as MonacoApi from 'monaco-editor';
import type {
  QuickSuggestions,
  TextEditorSettings,
  WordBasedSuggestions,
} from '@shared/angular/services/settings/settings';
import type { WordSuggestionsOption } from './monaco-suggest-commands';

/**
 * Holds Monaco's `quickSuggestions` for each choice.
 */
const QUICK_SUGGESTIONS: Readonly<
  Record<QuickSuggestions, MonacoApi.editor.IEditorOptions['quickSuggestions']>
> = {
  off: false,
  code: { other: 'on', comments: 'off', strings: 'off' },
  'code-and-strings': { other: 'on', comments: 'off', strings: 'on' },
  everywhere: { other: 'on', comments: 'on', strings: 'on' },
};

/**
 * Holds Monaco's `wordBasedSuggestions` for each choice.
 */
const WORD_SUGGESTIONS: Readonly<Record<WordBasedSuggestions, WordSuggestionsOption>> = {
  off: 'off',
  'this-file': 'currentDocument',
  'all-open-files': 'allDocuments',
};

/**
 * Builds the Monaco options for how the editor suggests, shared by the options an editor is created
 * with and the ones it re-applies when the settings change. Each is read per editor except
 * `suggestSelection`, which is read from the configuration a Monaco instance shares, and is safe there
 * as the setting is global. Word-Based Suggestions is per language and read from there too, so it is
 * not one of these; see {@link wordSuggestionsOption}.
 * @param resolved The code settings in force.
 * @returns Returns the options.
 */
export function editorSuggestOptions(
  resolved: TextEditorSettings,
): MonacoApi.editor.IEditorOptions {
  return {
    quickSuggestions: QUICK_SUGGESTIONS[resolved.quickSuggestions],
    quickSuggestionsDelay: resolved.quickSuggestionsDelay,
    suggestOnTriggerCharacters: resolved.suggestOnTriggerCharacters,
    acceptSuggestionOnCommitCharacter: resolved.acceptOnCommitCharacter,
    snippetSuggestions: resolved.snippetSuggestions,
    suggestSelection: resolved.suggestionSelection === 'first' ? 'first' : 'recentlyUsed',
    suggest: { insertMode: resolved.completionInsertMode },
    parameterHints: { enabled: resolved.parameterHints },
  };
}

/**
 * Builds Monaco's `wordBasedSuggestions` for a language's settings. Monaco reads it from the
 * configuration an instance shares across its editors, so the editor taking focus writes its own: only
 * the focused editor asks for suggestions, so its language's value is the one in force when it does.
 * @param resolved The code settings in force for the language.
 * @returns Returns the option's value.
 */
export function wordSuggestionsOption(resolved: TextEditorSettings): WordSuggestionsOption {
  return WORD_SUGGESTIONS[resolved.wordBasedSuggestions];
}
