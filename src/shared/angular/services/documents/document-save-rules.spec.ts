import { describe, expect, it } from 'vitest';
import { TEXT_EDITOR_SETTINGS } from '@shared/angular/services/settings/text-editor-settings.fixture';
import {
  applySaveRules,
  NO_SAVE_RULES,
  resolveSaveRules,
  saveRulesFromEditorConfig,
  saveRulesWhileTyping,
} from './document-save-rules';

describe('applySaveRules', () => {
  it('hands back the same string when nothing applies', () => {
    const text: string = 'a  \nb';

    expect(applySaveRules(text, NO_SAVE_RULES)).toBe(text);
  });

  it('trims the end of every line, whichever ending it has, and the last', () => {
    expect(
      applySaveRules('a \nb\t\r\nc  ', { ...NO_SAVE_RULES, trimTrailingWhitespace: true }),
    ).toBe('a\nb\r\nc');
  });

  it('leaves whitespace inside a line', () => {
    expect(applySaveRules('a  b\n', { ...NO_SAVE_RULES, trimTrailingWhitespace: true })).toBe(
      'a  b\n',
    );
  });

  it('adds a final newline only when there is none', () => {
    expect(applySaveRules('a', { ...NO_SAVE_RULES, finalNewline: 'insert' })).toBe('a\n');
    expect(applySaveRules('a\n', { ...NO_SAVE_RULES, finalNewline: 'insert' })).toBe('a\n');
  });

  it('leaves an empty file empty', () => {
    expect(applySaveRules('', { ...NO_SAVE_RULES, finalNewline: 'insert' })).toBe('');
  });

  it('adds the final newline in the ending the file uses', () => {
    expect(applySaveRules('a\r\nb', { ...NO_SAVE_RULES, finalNewline: 'insert' })).toBe(
      'a\r\nb\r\n',
    );
  });

  it('removes every final newline', () => {
    expect(applySaveRules('a\n\r\n', { ...NO_SAVE_RULES, finalNewline: 'remove' })).toBe('a');
  });

  it('converts mixed line endings', () => {
    expect(applySaveRules('a\nb\r\nc', { ...NO_SAVE_RULES, endOfLine: 'CRLF' })).toBe(
      'a\r\nb\r\nc',
    );
    expect(applySaveRules('a\r\nb', { ...NO_SAVE_RULES, endOfLine: 'LF' })).toBe('a\nb');
  });

  it('writes exactly what the acceptance list asks for', () => {
    expect(
      applySaveRules('a  \nb', {
        ...NO_SAVE_RULES,
        trimTrailingWhitespace: true,
        finalNewline: 'insert',
        endOfLine: 'CRLF',
      }),
    ).toBe('a\r\nb\r\n');
  });
});

describe('saveRulesFromEditorConfig', () => {
  it('asks nothing of a file none covers', () => {
    expect(saveRulesFromEditorConfig(null)).toEqual(NO_SAVE_RULES);
  });

  it('reads each property', () => {
    expect(
      saveRulesFromEditorConfig({
        trimTrailingWhitespace: true,
        insertFinalNewline: false,
        endOfLine: 'crlf',
      }),
    ).toEqual({
      trimTrailingWhitespace: true,
      finalNewline: 'remove',
      trimFinalNewlines: false,
      endOfLine: 'CRLF',
    });
  });

  it('leaves line endings alone for a bare CR, which Monaco cannot hold', () => {
    expect(saveRulesFromEditorConfig({ endOfLine: 'cr' }).endOfLine).toBeNull();
  });
});

describe('trimming final newlines', () => {
  it('leaves the last line its own newline', () => {
    expect(applySaveRules('a\n\n\r\n', { ...NO_SAVE_RULES, trimFinalNewlines: true })).toBe('a\n');
  });

  it('leaves text with one final newline, or none, alone', () => {
    expect(applySaveRules('a\n', { ...NO_SAVE_RULES, trimFinalNewlines: true })).toBe('a\n');
    expect(applySaveRules('a', { ...NO_SAVE_RULES, trimFinalNewlines: true })).toBe('a');
  });
});

describe('resolveSaveRules', () => {
  it('follows the settings where no .editorconfig speaks', () => {
    expect(
      resolveSaveRules(null, {
        ...TEXT_EDITOR_SETTINGS,
        trimTrailingWhitespace: true,
        insertFinalNewline: true,
        trimFinalNewlines: true,
      }),
    ).toEqual({
      trimTrailingWhitespace: true,
      finalNewline: 'insert',
      trimFinalNewlines: true,
      endOfLine: null,
    });
  });

  it('lets an .editorconfig win over the settings on what it states', () => {
    expect(
      resolveSaveRules(
        { trimTrailingWhitespace: false, insertFinalNewline: false },
        {
          ...TEXT_EDITOR_SETTINGS,
          trimTrailingWhitespace: true,
          insertFinalNewline: true,
          trimFinalNewlines: true,
        },
      ),
    ).toEqual({
      trimTrailingWhitespace: false,
      finalNewline: 'remove',
      trimFinalNewlines: false,
      endOfLine: null,
    });
  });

  it('keeps the settings for what an .editorconfig leaves out', () => {
    expect(
      resolveSaveRules(
        { endOfLine: 'crlf' },
        { ...TEXT_EDITOR_SETTINGS, trimTrailingWhitespace: true },
      ),
    ).toMatchObject({ trimTrailingWhitespace: true, endOfLine: 'CRLF' });
  });
});

describe('saveRulesWhileTyping', () => {
  it('keeps only the line endings', () => {
    expect(
      saveRulesWhileTyping({
        trimTrailingWhitespace: true,
        finalNewline: 'insert',
        trimFinalNewlines: true,
        endOfLine: 'CRLF',
      }),
    ).toEqual({ ...NO_SAVE_RULES, endOfLine: 'CRLF' });
  });
});
