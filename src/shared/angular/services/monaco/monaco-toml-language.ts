import type * as MonacoApi from 'monaco-editor';
import { inRealm } from './monaco-realm';

/**
 * Specifies the Monaco language identifier for TOML, the configuration format Cargo, Python's
 * `pyproject.toml` and many other tools read.
 */
export const TOML_LANGUAGE_ID: string = 'toml';

/**
 * A Monarch grammar for TOML: comments, table and array-of-tables headers, keys, the four kinds of
 * string, numbers, booleans and dates. Token names are the standard Monaco ones, so the application's
 * themes colour it with no theme changes, as the `cypher` grammar does. Monaco ships no TOML language
 * of its own, and a model whose language Monaco does not know falls back to plain text, so without this
 * registration no language server's provider would ever be asked about a TOML file.
 */
const TOML_GRAMMAR: MonacoApi.languages.IMonarchLanguage = {
  defaultToken: '',
  tokenizer: {
    root: [
      [/#.*$/, 'comment'],
      [/^\s*\[\[[^\]]*\]\]/, 'type'],
      [/^\s*\[[^\]]*\]/, 'type'],
      [/[A-Za-z0-9_-]+(?=\s*(\.|=))/, 'variable'],
      [/"""/, 'string', '@basicMultiline'],
      [/'''/, 'string', '@literalMultiline'],
      [/"([^"\\]|\\.)*"/, 'string'],
      [/'[^']*'/, 'string'],
      [/\b(true|false)\b/, 'keyword'],
      [/\d{4}-\d{2}-\d{2}([Tt ]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[-+]\d{2}:\d{2})?)?/, 'number'],
      [/\d{2}:\d{2}:\d{2}(\.\d+)?/, 'number'],
      [/[-+]?(inf|nan)\b/, 'number'],
      [/0x[0-9A-Fa-f_]+|0o[0-7_]+|0b[01_]+/, 'number'],
      [/[-+]?\d[\d_]*(\.[\d_]+)?([eE][-+]?\d+)?/, 'number'],
      [/[=.,[\]{}]/, 'delimiter'],
    ],
    basicMultiline: [
      [/"""/, 'string', '@pop'],
      [/\\./, 'string.escape'],
      [/[^"\\]+|"/, 'string'],
    ],
    literalMultiline: [
      [/'''/, 'string', '@pop'],
      [/[^']+|'/, 'string'],
    ],
  },
};

/**
 * Registers the `toml` language and its Monarch grammar with Monaco, so a TOML file is highlighted and
 * reaches the language server that serves it. Idempotent and a no-op when Monaco has not loaded.
 * @param monaco The loaded Monaco namespace, or undefined when it has not loaded yet.
 * @param realm The window the instance was loaded into, when it is not this one.
 */
export function registerTomlLanguage(
  monaco: typeof MonacoApi | undefined,
  realm: Window | undefined = undefined,
): void {
  if (monaco === undefined) {
    return;
  }
  const registered: boolean = monaco.languages
    .getLanguages()
    .some(
      (language: MonacoApi.languages.ILanguageExtensionPoint): boolean =>
        language.id === TOML_LANGUAGE_ID,
    );
  if (registered) {
    return;
  }
  monaco.languages.register({ id: TOML_LANGUAGE_ID, extensions: ['.toml'], aliases: ['TOML'] });
  monaco.languages.setMonarchTokensProvider(
    TOML_LANGUAGE_ID,
    realm === undefined ? TOML_GRAMMAR : inRealm(TOML_GRAMMAR, realm),
  );
  monaco.languages.setLanguageConfiguration(TOML_LANGUAGE_ID, {
    comments: { lineComment: '#' },
    brackets: [
      ['[', ']'],
      ['{', '}'],
    ],
    autoClosingPairs: [
      { open: '[', close: ']' },
      { open: '{', close: '}' },
      { open: '"', close: '"' },
      { open: "'", close: "'" },
    ],
  });
}
