import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { EditorConfigResolution } from '@shared/api/editor-config-channels';
import { EditorConfigReader, resolveEditorConfig } from './editor-config-resolver';

/**
 * Builds a reader over named `.editorconfig` files.
 * @param files The files, by path.
 * @returns Returns the reader.
 */
function reader(files: Readonly<Record<string, string>>): EditorConfigReader {
  return (filePath: string): Promise<string | null> => Promise.resolve(files[filePath] ?? null);
}

describe('resolveEditorConfig', () => {
  it('finds nothing with no file, naming every folder walked', async () => {
    const result: EditorConfigResolution = await resolveEditorConfig(
      '/a/b/c.ts',
      reader({}),
      path.posix,
    );

    expect(result.properties).toEqual({});
    expect(result.candidates).toEqual(['/a/b/.editorconfig', '/a/.editorconfig', '/.editorconfig']);
  });

  it('stops walking at root = true', async () => {
    const result: EditorConfigResolution = await resolveEditorConfig(
      '/a/b/c.ts',
      reader({
        '/.editorconfig': '[*]\nindent_size = 8',
        '/a/.editorconfig': 'root = true\n[*]\nindent_style = tab',
      }),
      path.posix,
    );

    expect(result.properties).toEqual({ indentStyle: 'tab' });
    expect(result.candidates).toEqual(['/a/b/.editorconfig', '/a/.editorconfig']);
  });

  it('lets a nearer file win', async () => {
    const result: EditorConfigResolution = await resolveEditorConfig(
      '/a/b/c.ts',
      reader({
        '/a/.editorconfig': '[*]\nindent_size = 4\nindent_style = space',
        '/a/b/.editorconfig': '[*]\nindent_size = 2',
      }),
      path.posix,
    );

    expect(result.properties).toEqual({ indentSize: 2, indentStyle: 'space' });
  });

  it('lets a later section win', async () => {
    const result: EditorConfigResolution = await resolveEditorConfig(
      '/a/c.md',
      reader({ '/a/.editorconfig': '[*]\nindent_size = 4\n[*.md]\nindent_size = 2' }),
      path.posix,
    );

    expect(result.properties.indentSize).toBe(2);
  });

  it('applies a nested file only below its folder', async () => {
    const files: Readonly<Record<string, string>> = {
      '/a/docs/.editorconfig': '[*.md]\nindent_size = 2',
    };

    const inside: EditorConfigResolution = await resolveEditorConfig(
      '/a/docs/x.md',
      reader(files),
      path.posix,
    );
    const outside: EditorConfigResolution = await resolveEditorConfig(
      '/a/x.md',
      reader(files),
      path.posix,
    );

    expect(inside.properties.indentSize).toBe(2);
    expect(outside.properties.indentSize).toBeUndefined();
  });

  it('matches a slashed section from its own folder, not the file system root', async () => {
    const result: EditorConfigResolution = await resolveEditorConfig(
      '/a/src/x.ts',
      reader({ '/a/.editorconfig': '[src/*.ts]\nindent_size = 3' }),
      path.posix,
    );

    expect(result.properties.indentSize).toBe(3);
  });

  it('clears a property with unset', async () => {
    const result: EditorConfigResolution = await resolveEditorConfig(
      '/a/b/c.ts',
      reader({
        '/a/.editorconfig': '[*]\nindent_size = 4',
        '/a/b/.editorconfig': '[*]\nindent_size = unset',
      }),
      path.posix,
    );

    expect(result.properties).toEqual({});
  });

  it('types every property', async () => {
    const result: EditorConfigResolution = await resolveEditorConfig(
      '/a/c.ts',
      reader({
        '/a/.editorconfig':
          '[*]\nindent_style = TAB\nindent_size = tab\ntab_width = 4\nend_of_line = CRLF\n' +
          'charset = utf-8-bom\ntrim_trailing_whitespace = true\ninsert_final_newline = false\n' +
          'max_line_length = 100',
      }),
      path.posix,
    );

    expect(result.properties).toEqual({
      indentStyle: 'tab',
      indentSize: 'tab',
      tabWidth: 4,
      endOfLine: 'crlf',
      charset: 'utf-8-bom',
      trimTrailingWhitespace: true,
      insertFinalNewline: false,
      maxLineLength: 100,
    });
  });

  it('reads max_line_length = off', async () => {
    const result: EditorConfigResolution = await resolveEditorConfig(
      '/a/c.ts',
      reader({ '/a/.editorconfig': '[*]\nmax_line_length = off' }),
      path.posix,
    );

    expect(result.properties.maxLineLength).toBe('off');
  });

  it('drops values it does not understand', async () => {
    const result: EditorConfigResolution = await resolveEditorConfig(
      '/a/c.ts',
      reader({
        '/a/.editorconfig':
          '[*]\nindent_style = banana\nindent_size = -1\nend_of_line = nel\ncharset = ebcdic\n' +
          'trim_trailing_whitespace = maybe',
      }),
      path.posix,
    );

    expect(result.properties).toEqual({});
  });

  it('walks Windows paths and matches with forward slashes', async () => {
    const result: EditorConfigResolution = await resolveEditorConfig(
      'C:\\a\\src\\x.ts',
      reader({ 'C:\\a\\.editorconfig': '[src/*.ts]\nindent_size = 3' }),
      path.win32,
    );

    expect(result.properties.indentSize).toBe(3);
  });

  it('answers nothing for a relative path', async () => {
    expect(await resolveEditorConfig('x.ts', reader({}), path.posix)).toEqual({
      properties: {},
      candidates: [],
    });
  });
});
