import { describe, expect, it } from 'vitest';
import { TEXT_EDITOR_SETTINGS } from '@shared/angular/services/settings/text-editor-settings.fixture';
import { editorTypingOptions } from './editor-typing-options';

describe('editorTypingOptions', () => {
  it('closes brackets and quotes before whitespace on the default settings', () => {
    expect(editorTypingOptions(TEXT_EDITOR_SETTINGS)).toMatchObject({
      autoClosingBrackets: 'beforeWhitespace',
      autoClosingQuotes: 'beforeWhitespace',
      autoSurround: 'languageDefined',
      autoIndent: 'full',
      linkedEditing: true,
      multiCursorModifier: 'alt',
      unusualLineTerminators: 'prompt',
    });
  });

  it('applies the one auto close setting to brackets and quotes alike', () => {
    expect(
      editorTypingOptions({ ...TEXT_EDITOR_SETTINGS, autoCloseBrackets: 'never' }),
    ).toMatchObject({ autoClosingBrackets: 'never', autoClosingQuotes: 'never' });
  });

  it('maps the rest of the choices to what Monaco calls them', () => {
    expect(
      editorTypingOptions({
        ...TEXT_EDITOR_SETTINGS,
        autoSurround: 'brackets',
        multiCursorModifier: 'ctrl-cmd',
        unusualLineTerminators: 'remove',
      }),
    ).toMatchObject({
      autoSurround: 'brackets',
      multiCursorModifier: 'ctrlCmd',
      unusualLineTerminators: 'auto',
    });
    expect(
      editorTypingOptions({ ...TEXT_EDITOR_SETTINGS, unusualLineTerminators: 'ignore' })
        .unusualLineTerminators,
    ).toBe('off');
  });
});
