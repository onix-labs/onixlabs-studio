import { describe, expect, it } from 'vitest';
import type { TextEditorSettings } from '@shared/angular/services/settings/settings';
import { TEXT_EDITOR_SETTINGS } from '@shared/angular/services/settings/text-editor-settings.fixture';
import { editorSuggestOptions, wordSuggestionsOption } from './editor-suggest-options';

/**
 * Builds code settings from the defaults, with some changed.
 * @param changes The settings to change.
 * @returns Returns the settings.
 */
function settings(changes: Partial<TextEditorSettings> = {}): TextEditorSettings {
  return { ...TEXT_EDITOR_SETTINGS, ...changes };
}

describe('editorSuggestOptions', () => {
  it('holds the ruled defaults', () => {
    expect(editorSuggestOptions(settings())).toEqual({
      quickSuggestions: { other: 'on', comments: 'off', strings: 'off' },
      quickSuggestionsDelay: 0,
      suggestOnTriggerCharacters: true,
      acceptSuggestionOnCommitCharacter: true,
      snippetSuggestions: 'inline',
      suggestSelection: 'recentlyUsed',
      suggest: { insertMode: 'insert' },
      parameterHints: { enabled: true },
    });
  });

  it('maps each Quick Suggestions choice', () => {
    expect(editorSuggestOptions(settings({ quickSuggestions: 'off' })).quickSuggestions).toBe(
      false,
    );
    expect(
      editorSuggestOptions(settings({ quickSuggestions: 'code-and-strings' })).quickSuggestions,
    ).toEqual({ other: 'on', comments: 'off', strings: 'on' });
    expect(
      editorSuggestOptions(settings({ quickSuggestions: 'everywhere' })).quickSuggestions,
    ).toEqual({ other: 'on', comments: 'on', strings: 'on' });
  });

  it('maps the selection, insert mode and parameter hints', () => {
    const options: ReturnType<typeof editorSuggestOptions> = editorSuggestOptions(
      settings({
        suggestionSelection: 'first',
        completionInsertMode: 'replace',
        parameterHints: false,
      }),
    );

    expect(options.suggestSelection).toBe('first');
    expect(options.suggest?.insertMode).toBe('replace');
    expect(options.parameterHints?.enabled).toBe(false);
  });
});

describe('wordSuggestionsOption', () => {
  it('maps each choice', () => {
    expect(wordSuggestionsOption(settings({ wordBasedSuggestions: 'off' }))).toBe('off');
    expect(wordSuggestionsOption(settings({ wordBasedSuggestions: 'this-file' }))).toBe(
      'currentDocument',
    );
    expect(wordSuggestionsOption(settings({ wordBasedSuggestions: 'all-open-files' }))).toBe(
      'allDocuments',
    );
  });
});
