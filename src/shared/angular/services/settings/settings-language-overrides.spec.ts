import { describe, expect, it } from 'vitest';

import type { LanguageOverrides, TextEditorSettings } from './settings';
import {
  clearLanguageOverride,
  resolveForLanguage,
  setLanguageOverride,
} from './settings-language-overrides';

const GLOBAL: TextEditorSettings = {
  showLineNumbers: true,
  showMinimap: true,
  currentLineHighlight: 'filled',
  colorBrackets: true,
  wordWrap: false,
  stickyScroll: true,
  cursorBlinking: 'blink',
  cursorSmoothCaretAnimation: 'off',
  insertSpaces: true,
  tabSize: 4,
  fontFamily: 'monospace',
  fontSize: 14,
  lineHeight: 1.5,
  braceStyle: 'kr',
};

describe('settings-language-overrides', () => {
  it('resolveForLanguage_whenNoOverrides_returnsTheGlobalObject', () => {
    expect(resolveForLanguage(GLOBAL, {}, 'rust')).toBe(GLOBAL);
  });

  it('resolveForLanguage_whenOverridden_laysTheLanguageOverGlobal', () => {
    const overrides: LanguageOverrides = { rust: { tabSize: 2, wordWrap: true } };

    const resolved: TextEditorSettings = resolveForLanguage(GLOBAL, overrides, 'rust');

    expect(resolved.tabSize).toBe(2);
    expect(resolved.wordWrap).toBe(true);
    expect(resolved.fontSize).toBe(14);
    expect(resolveForLanguage(GLOBAL, overrides, 'go')).toBe(GLOBAL);
  });

  it('setLanguageOverride_addsAFieldWithoutDisturbingOthers', () => {
    const first: LanguageOverrides = setLanguageOverride({}, 'rust', 'tabSize', 2);
    const second: LanguageOverrides = setLanguageOverride(first, 'rust', 'wordWrap', true);
    const third: LanguageOverrides = setLanguageOverride(second, 'go', 'tabSize', 8);

    expect(third).toEqual({ rust: { tabSize: 2, wordWrap: true }, go: { tabSize: 8 } });
    expect(first).toEqual({ rust: { tabSize: 2 } });
  });

  it('clearLanguageOverride_removesTheFieldAndDropsAnEmptyLanguage', () => {
    const overrides: LanguageOverrides = {
      rust: { tabSize: 2, wordWrap: true },
      go: { tabSize: 8 },
    };

    const oneLeft: LanguageOverrides = clearLanguageOverride(overrides, 'rust', 'tabSize');
    expect(oneLeft).toEqual({ rust: { wordWrap: true }, go: { tabSize: 8 } });

    const rustGone: LanguageOverrides = clearLanguageOverride(oneLeft, 'rust', 'wordWrap');
    expect(rustGone).toEqual({ go: { tabSize: 8 } });
  });

  it('clearLanguageOverride_whenNothingToClear_returnsTheSameMap', () => {
    const overrides: LanguageOverrides = { go: { tabSize: 8 } };

    expect(clearLanguageOverride(overrides, 'rust', 'tabSize')).toBe(overrides);
    expect(clearLanguageOverride(overrides, 'go', 'wordWrap')).toBe(overrides);
  });
});
