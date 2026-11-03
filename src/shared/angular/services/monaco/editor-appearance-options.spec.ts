import { describe, expect, it } from 'vitest';
import type { TextEditorSettings } from '@shared/angular/services/settings/settings';
import { TEXT_EDITOR_SETTINGS } from '@shared/angular/services/settings/text-editor-settings.fixture';
import { SETTINGS_BY_KEY } from '@shared/angular/services/settings/settings-registry';
import { editorAppearanceOptions } from './editor-appearance-options';

/**
 * Builds code settings from the defaults, with some changed.
 * @param changes The settings to change.
 * @returns Returns the settings.
 */
function settings(changes: Partial<TextEditorSettings> = {}): TextEditorSettings {
  return { ...TEXT_EDITOR_SETTINGS, ...changes };
}

describe('editorAppearanceOptions', () => {
  it('has a fixture matching the registered defaults', () => {
    const entries: [string, unknown][] = Object.entries(TEXT_EDITOR_SETTINGS);
    for (const [field, value] of entries) {
      const key: string = `textEditor.global.${field}`;
      expect(SETTINGS_BY_KEY.get(key), key).toMatchObject({ default: value });
    }
  });

  it('keeps the editor as it was on the default settings', () => {
    expect(editorAppearanceOptions(settings())).toMatchObject({
      renderWhitespace: 'selection',
      rulers: [],
      guides: { indentation: true, highlightActiveIndentation: true, bracketPairs: false },
      matchBrackets: 'always',
      fontLigatures: false,
      cursorStyle: 'line',
      cursorWidth: 2,
      scrollBeyondLastLine: false,
      showFoldingControls: 'always',
      colorDecorators: true,
      extraEditorClassName: '',
    });
  });

  it('turns the indent guides off altogether', () => {
    expect(editorAppearanceOptions(settings({ indentGuides: 'off' })).guides).toMatchObject({
      indentation: false,
      highlightActiveIndentation: false,
    });
  });

  it('maps each bracket pair guide choice', () => {
    expect(
      editorAppearanceOptions(settings({ bracketPairGuides: 'active' })).guides?.bracketPairs,
    ).toBe('active');
    expect(
      editorAppearanceOptions(settings({ bracketPairGuides: 'all' })).guides?.bracketPairs,
    ).toBe(true);
  });

  it('reads the rulers into columns', () => {
    expect(editorAppearanceOptions(settings({ rulers: '80, 120' })).rulers).toEqual([80, 120]);
  });

  it('shows the fold controls on hover', () => {
    expect(
      editorAppearanceOptions(settings({ foldingControls: 'hover' })).showFoldingControls,
    ).toBe('mouseover');
  });

  it('marks the editor with the least severe problem it underlines', () => {
    expect(
      editorAppearanceOptions(settings({ minimumDiagnosticSeverity: 'warning' }))
        .extraEditorClassName,
    ).toBe('minimum-severity-warning');
  });
});
