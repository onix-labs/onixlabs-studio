import { describe, expect, it } from 'vitest';
import { applySaveRules, NO_SAVE_RULES, saveRulesFromEditorConfig } from './document-save-rules';

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
    ).toEqual({ trimTrailingWhitespace: true, finalNewline: 'remove', endOfLine: 'CRLF' });
  });

  it('leaves line endings alone for a bare CR, which Monaco cannot hold', () => {
    expect(saveRulesFromEditorConfig({ endOfLine: 'cr' }).endOfLine).toBeNull();
  });
});
