import { describe, expect, it } from 'vitest';
import {
  BaseIndentation,
  fixesIndentation,
  indentationLabel,
  resolveIndentation,
} from './resolve-indentation';

const SETTINGS: BaseIndentation = { tabSize: 2, insertSpaces: true };
const DETECTED: BaseIndentation = { tabSize: 4, insertSpaces: false };

describe('resolveIndentation', () => {
  it('uses the settings when nothing else speaks', () => {
    expect(resolveIndentation(SETTINGS, null, null)).toEqual({
      tabSize: 2,
      indentSize: 2,
      insertSpaces: true,
    });
  });

  it('prefers the content over the settings', () => {
    expect(resolveIndentation(SETTINGS, DETECTED, null)).toEqual({
      tabSize: 4,
      indentSize: 4,
      insertSpaces: false,
    });
  });

  it('lets EditorConfig win, property by property', () => {
    expect(resolveIndentation(SETTINGS, DETECTED, { indentStyle: 'space' })).toEqual({
      tabSize: 4,
      indentSize: 4,
      insertSpaces: true,
    });
  });

  it('draws a tab at indent_size when tab_width is not set', () => {
    expect(resolveIndentation(SETTINGS, null, { indentStyle: 'tab', indentSize: 8 })).toEqual({
      tabSize: 8,
      indentSize: 8,
      insertSpaces: false,
    });
  });

  it('keeps indent_size and tab_width apart', () => {
    expect(resolveIndentation(SETTINGS, null, { indentSize: 4, tabWidth: 8 })).toEqual({
      tabSize: 8,
      indentSize: 4,
      insertSpaces: true,
    });
  });

  it('reads indent_size = tab as tab_width', () => {
    expect(resolveIndentation(SETTINGS, null, { indentSize: 'tab', tabWidth: 3 })).toEqual({
      tabSize: 3,
      indentSize: 3,
      insertSpaces: true,
    });
  });
});

describe('fixesIndentation', () => {
  it('needs both a style and a width', () => {
    expect(fixesIndentation(null)).toBe(false);
    expect(fixesIndentation({ indentStyle: 'tab' })).toBe(false);
    expect(fixesIndentation({ indentSize: 2 })).toBe(false);
    expect(fixesIndentation({ indentStyle: 'tab', tabWidth: 4 })).toBe(true);
  });
});

describe('indentationLabel', () => {
  it('names the style and the width', () => {
    expect(indentationLabel({ tabSize: 8, indentSize: 4, insertSpaces: true })).toBe('Spaces: 4');
    expect(indentationLabel({ tabSize: 4, indentSize: 4, insertSpaces: false })).toBe('Tabs: 4');
  });
});
