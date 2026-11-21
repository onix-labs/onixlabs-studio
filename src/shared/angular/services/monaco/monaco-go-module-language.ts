import type * as MonacoApi from 'monaco-editor';
import { inRealm } from './monaco-realm';

/**
 * Specifies the Monaco language identifier for a Go module file, `go.mod`. It is gopls's own language
 * id for the file (#1211): gopls reads a document by the id it is opened with, so a `go.mod` opened as
 * `go` is parsed as Go source and fails, and one opened as plain text never reaches gopls at all.
 */
export const GO_MODULE_LANGUAGE_ID: string = 'go.mod';

/**
 * Specifies the Monaco language identifier for a Go workspace file, `go.work`, gopls's own id for it.
 */
export const GO_WORKSPACE_LANGUAGE_ID: string = 'go.work';

/**
 * A Monarch grammar for `go.mod` and `go.work`, which share one syntax: directives (`module`,
 * `require`, `replace`, `use`…), optionally as a parenthesised block, then module paths, versions and
 * `//` comments. Token names are the standard Monaco ones, so the themes colour them unchanged.
 */
const GO_MODULE_GRAMMAR: MonacoApi.languages.IMonarchLanguage = {
  defaultToken: '',
  keywords: [
    'module',
    'go',
    'toolchain',
    'godebug',
    'require',
    'replace',
    'exclude',
    'retract',
    'tool',
    'ignore',
    'use',
  ],
  tokenizer: {
    root: [
      [/\/\/.*$/, 'comment'],
      [/"([^"\\]|\\.)*"/, 'string'],
      [/`[^`]*`/, 'string'],
      // A version: a semantic version or pseudo-version (`v0.44.0`, `v0.0.0-2026…-abc`), or a bare Go
      // release on a `go` or `toolchain` line (`1.27`, `go1.27.4`).
      [/\bv\d+\.\d+\.\d+[\w.+-]*/, 'number'],
      [/\b(?:go)?\d+\.\d+(?:\.\d+)?(?:rc\d+)?\b/, 'number'],
      [/=>/, 'operator'],
      [/[()[\],]/, 'delimiter'],
      // A directive starts its line; inside a block the indented lines are paths, so a path segment
      // such as `tool` is not taken for one.
      [/^[a-z]+\b/, { cases: { '@keywords': 'keyword', '@default': 'identifier' } }],
      [/[^\s()[\],"`]+/, 'identifier'],
    ],
  },
};

/**
 * Gets the go.mod grammar, exposed for the spec that checks its rules.
 * @returns Returns the grammar.
 */
export function goModuleGrammar(): MonacoApi.languages.IMonarchLanguage {
  return GO_MODULE_GRAMMAR;
}

/**
 * Registers the `go.mod` and `go.work` languages and their grammar with Monaco, so the files colour
 * and are served by gopls: its tidy, upgrade, vendor and vulnerability lenses, its hover on a
 * dependency, and its diagnostics, live in `go.mod`. Idempotent and a no-op when Monaco has not loaded.
 * @param monaco The loaded Monaco namespace, or undefined when it has not loaded yet.
 * @param realm The window the instance was loaded into, when it is not this one: the grammar's
 * regular expressions are rebuilt there, since Monaco refuses another window's.
 */
export function registerGoModuleLanguages(
  monaco: typeof MonacoApi | undefined,
  realm: Window | undefined = undefined,
): void {
  if (monaco === undefined) {
    return;
  }
  const known: ReadonlySet<string> = new Set<string>(
    monaco.languages
      .getLanguages()
      .map((language: MonacoApi.languages.ILanguageExtensionPoint): string => language.id),
  );
  const grammar: MonacoApi.languages.IMonarchLanguage =
    realm === undefined ? GO_MODULE_GRAMMAR : inRealm(GO_MODULE_GRAMMAR, realm);
  for (const id of [GO_MODULE_LANGUAGE_ID, GO_WORKSPACE_LANGUAGE_ID]) {
    if (known.has(id)) {
      continue;
    }
    monaco.languages.register({ id, filenames: [id] });
    monaco.languages.setMonarchTokensProvider(id, grammar);
    monaco.languages.setLanguageConfiguration(id, {
      comments: { lineComment: '//' },
      brackets: [['(', ')']],
      autoClosingPairs: [
        { open: '(', close: ')' },
        { open: '"', close: '"' },
      ],
    });
  }
}
