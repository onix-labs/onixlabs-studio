import type * as MonacoApi from 'monaco-editor';
import { inRealm } from './monaco-realm';

/**
 * Specifies the Monaco language identifier for Cypher, the graph query language Neo4j speaks.
 */
export const CYPHER_LANGUAGE_ID: string = 'cypher';

/**
 * Cypher's clause and expression keywords, matched case-insensitively.
 */
const KEYWORDS: readonly string[] = [
  'MATCH',
  'OPTIONAL',
  'WHERE',
  'RETURN',
  'WITH',
  'UNWIND',
  'CREATE',
  'MERGE',
  'DELETE',
  'DETACH',
  'SET',
  'REMOVE',
  'ORDER',
  'BY',
  'SKIP',
  'LIMIT',
  'ASC',
  'ASCENDING',
  'DESC',
  'DESCENDING',
  'DISTINCT',
  'AS',
  'CALL',
  'YIELD',
  'UNION',
  'ALL',
  'ON',
  'AND',
  'OR',
  'XOR',
  'NOT',
  'IN',
  'IS',
  'NULL',
  'TRUE',
  'FALSE',
  'CASE',
  'WHEN',
  'THEN',
  'ELSE',
  'END',
  'EXISTS',
  'STARTS',
  'ENDS',
  'CONTAINS',
  'FOREACH',
  'LOAD',
  'CSV',
  'FROM',
  'HEADERS',
  'USE',
  'SHOW',
  'INDEX',
  'INDEXES',
  'CONSTRAINT',
  'CONSTRAINTS',
  'DROP',
  'IF',
  'FOR',
  'REQUIRE',
  'UNIQUE',
  'KEY',
  'NODE',
  'RELATIONSHIP',
  'DATABASE',
  'DATABASES',
  'TRANSACTIONS',
  'OF',
  'ROWS',
  'EXPLAIN',
  'PROFILE',
  'COUNT',
  'COLLECT',
];

/**
 * A Monarch grammar for Cypher: keywords, strings, numbers, comments, `$parameters`, `:Label` and
 * `:TYPE` names, and backtick-quoted identifiers. Token names are the standard Monaco ones, so the
 * application's themes colour it with no theme changes — as the `asm` grammar does.
 */
const CYPHER_GRAMMAR: MonacoApi.languages.IMonarchLanguage = {
  ignoreCase: true,
  defaultToken: '',
  keywords: KEYWORDS.map((keyword: string): string => keyword.toLowerCase()),
  tokenizer: {
    root: [
      [/\/\/.*$/, 'comment'],
      [/\/\*/, 'comment', '@comment'],
      [/'([^'\\]|\\.)*'/, 'string'],
      [/"([^"\\]|\\.)*"/, 'string'],
      [/`[^`]*`/, 'identifier'],
      [/\$[A-Za-z_]\w*/, 'variable.predefined'],
      [/:\s*[A-Za-z_]\w*/, 'type'],
      [/\b\d+(\.\d+)?([eE][-+]?\d+)?\b/, 'number'],
      [/[A-Za-z_]\w*(?=\s*\()/, 'predefined'],
      [/[A-Za-z_]\w*/, { cases: { '@keywords': 'keyword', '@default': 'identifier' } }],
      [/[-<>=]+|[()[\]{},.;|+*/%^]/, 'delimiter'],
    ],
    comment: [
      [/\*\//, 'comment', '@pop'],
      [/[^*]+/, 'comment'],
      [/\*/, 'comment'],
    ],
  },
};

/**
 * Registers the `cypher` language and its Monarch grammar with Monaco, so a Neo4j query document is
 * highlighted. Idempotent and a no-op when Monaco has not loaded.
 * @param monaco The loaded Monaco namespace, or undefined when it has not loaded yet.
 * @param realm The window the instance was loaded into, when it is not this one.
 */
export function registerCypherLanguage(
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
        language.id === CYPHER_LANGUAGE_ID,
    );
  if (registered) {
    return;
  }
  monaco.languages.register({
    id: CYPHER_LANGUAGE_ID,
    extensions: ['.cypher', '.cql'],
    aliases: ['Cypher'],
  });
  monaco.languages.setMonarchTokensProvider(
    CYPHER_LANGUAGE_ID,
    realm === undefined ? CYPHER_GRAMMAR : inRealm(CYPHER_GRAMMAR, realm),
  );
  monaco.languages.setLanguageConfiguration(CYPHER_LANGUAGE_ID, {
    comments: { lineComment: '//', blockComment: ['/*', '*/'] },
    brackets: [
      ['(', ')'],
      ['[', ']'],
      ['{', '}'],
    ],
    autoClosingPairs: [
      { open: '(', close: ')' },
      { open: '[', close: ']' },
      { open: '{', close: '}' },
      { open: "'", close: "'" },
      { open: '"', close: '"' },
      { open: '`', close: '`' },
    ],
  });
}
