import { describe, expect, it } from 'vitest';
import { EditorConfigFile, parseEditorConfig } from './editor-config-parser';

describe('parseEditorConfig', () => {
  it('reads root and sections in order', () => {
    const file: EditorConfigFile = parseEditorConfig(
      'root = true\n\n[*]\nindent_style = tab\n\n[*.md]\nindent_size=2\n',
    );

    expect(file.root).toBe(true);
    expect(file.sections.map((section) => section.glob)).toEqual(['*', '*.md']);
    expect(file.sections[1].properties.get('indent_size')).toBe('2');
  });

  it('reads root whatever its case, and only before the first section', () => {
    expect(parseEditorConfig('ROOT = TRUE').root).toBe(true);
    expect(parseEditorConfig('[*]\nroot = true').root).toBe(false);
  });

  it('lower-cases names and keeps values as written', () => {
    const file: EditorConfigFile = parseEditorConfig('[*]\nIndent_Style = TAB');

    expect(file.sections[0].properties.get('indent_style')).toBe('TAB');
  });

  it('skips comments and lines it does not understand', () => {
    const file: EditorConfigFile = parseEditorConfig(
      '# comment\n; comment\n[*]\nnonsense\n=novalue\nindent_size = 4\n',
    );

    expect([...file.sections[0].properties.keys()]).toEqual(['indent_size']);
  });

  it('keeps a hash inside a value, as comments are whole lines', () => {
    const file: EditorConfigFile = parseEditorConfig('[*]\nname = a # b');

    expect(file.sections[0].properties.get('name')).toBe('a # b');
  });

  it('copes with a byte-order mark and CRLF lines', () => {
    const file: EditorConfigFile = parseEditorConfig('\uFEFFroot = true\r\n[*]\r\nindent_size = 4');

    expect(file.root).toBe(true);
    expect(file.sections[0].properties.get('indent_size')).toBe('4');
  });
});
