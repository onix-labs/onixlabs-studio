import type * as MonacoApi from 'monaco-editor';
import { inRealm } from './monaco-realm';

/**
 * Specifies the Monaco language identifier for C#.
 */
export const CSHARP_LANGUAGE_ID: string = 'csharp';

/**
 * A Monarch grammar for C#, replacing the one Monaco ships.
 *
 * Derived from `monaco-editor`'s C# grammar (MIT, monaco-editor 0.57.0), which predates most of the
 * language's contextual keywords: `record`, `with`, extension blocks and C# 15's `union` and `closed`
 * all read as plain identifiers until the language server's semantic tokens arrive, which on a large
 * solution can take a while. This version adds them at the head of the root state, each only in the
 * position the language gives it meaning (#1450). Everything else is Monaco's grammar unchanged, and the
 * token names are the ones it emits, so the application's themes colour it without change.
 *
 * Labels (`rows:` and `break rows;`) are left as identifiers, as Monaco's grammar reads them: Roslyn
 * classifies them as labels, which Studio colours as variables once its tokens arrive.
 */
const CSHARP_GRAMMAR: MonacoApi.languages.IMonarchLanguage = {
  defaultToken: '',
  tokenPostfix: '.cs',
  brackets: [
    { open: '{', close: '}', token: 'delimiter.curly' },
    { open: '[', close: ']', token: 'delimiter.square' },
    { open: '(', close: ')', token: 'delimiter.parenthesis' },
    { open: '<', close: '>', token: 'delimiter.angle' },
  ],
  keywords: [
    'extern',
    'alias',
    'using',
    'bool',
    'decimal',
    'sbyte',
    'byte',
    'short',
    'ushort',
    'int',
    'uint',
    'long',
    'ulong',
    'char',
    'float',
    'double',
    'object',
    'dynamic',
    'string',
    'assembly',
    'is',
    'as',
    'ref',
    'out',
    'this',
    'base',
    'new',
    'typeof',
    'void',
    'checked',
    'unchecked',
    'default',
    'delegate',
    'var',
    'const',
    'if',
    'else',
    'switch',
    'case',
    'while',
    'do',
    'for',
    'foreach',
    'in',
    'break',
    'continue',
    'goto',
    'return',
    'throw',
    'try',
    'catch',
    'finally',
    'lock',
    'yield',
    'from',
    'let',
    'where',
    'join',
    'on',
    'equals',
    'into',
    'orderby',
    'ascending',
    'descending',
    'select',
    'group',
    'by',
    'namespace',
    'partial',
    'class',
    'field',
    'event',
    'method',
    'param',
    'public',
    'protected',
    'internal',
    'private',
    'abstract',
    'sealed',
    'static',
    'struct',
    'readonly',
    'volatile',
    'virtual',
    'override',
    'params',
    'get',
    'set',
    'add',
    'remove',
    'operator',
    'true',
    'false',
    'implicit',
    'explicit',
    'interface',
    'enum',
    'null',
    'async',
    'await',
    'fixed',
    'sizeof',
    'stackalloc',
    'unsafe',
    'nameof',
    'when',
  ],
  namespaceFollows: ['namespace', 'using'],
  parenFollows: ['if', 'for', 'while', 'switch', 'foreach', 'using', 'catch', 'when'],
  operators: [
    '=',
    '??',
    '||',
    '&&',
    '|',
    '^',
    '&',
    '==',
    '!=',
    '<=',
    '>=',
    '<<',
    '+',
    '-',
    '*',
    '/',
    '%',
    '!',
    '~',
    '++',
    '--',
    '+=',
    '-=',
    '*=',
    '/=',
    '%=',
    '&=',
    '|=',
    '^=',
    '<<=',
    '>>=',
    '>>',
    '=>',
  ],
  symbols: /[=><!~?:&|+\-*/^%]+/,
  // escape sequences
  escapes: /\\(?:[abfnrtv\\"']|x[0-9A-Fa-f]{1,4}|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8})/,
  // The main tokenizer for our languages
  tokenizer: {
    root: [
      // C# 15 and the contextual keywords around it (#1450). Each is a keyword only where the language
      // makes it one, so a variable named `closed` or a method named `with` keeps its identifier colour.
      // A union declaration: `union Pet(Cat, Dog)`, generic or not.
      [/union(?=\s+[A-Za-z_]\w*\s*(?:<[^>]*>)?\s*\()/, 'keyword.union'],
      // A closed class: `closed` among the modifiers before `class` or `record`.
      [
        /closed(?=\s+(?:(?:public|internal|protected|private|partial|unsafe|new|file|abstract)\s+)*(?:record|class)\b)/,
        'keyword.closed',
      ],
      // A record declaration, which a closed hierarchy is usually made of.
      [/record(?=\s+(?:class|struct)\b|\s+[A-Za-z_]\w*\s*(?:<[^>]*>)?\s*[({:;])/, 'keyword.record'],
      // An extension block, `extension(IEnumerable<int> sequence)`, which extension indexers live in;
      // a call to a method named `extension` ends in a semicolon instead.
      [/extension(?=\s*(?:<[^>]*>)?\s*\([^()]*\)\s*(?:where\b|\{|$))/, 'keyword.extension'],
      // A `with` expression, `point with { X = 1 }`.
      [/with(?=\s*\{)/, 'keyword.with'],
      // Collection-expression arguments, `[with(capacity: 10), ...]`: `with` as the first element.
      // The bracket is named as `@brackets` would name it, which a group action is not given.
      [/(\[)(\s*)(with)(?=\s*\()/, ['delimiter.square', '', 'keyword.with']],
      // identifiers and keywords
      [
        /@?[a-zA-Z_]\w*/,
        {
          cases: {
            '@namespaceFollows': {
              token: 'keyword.$0',
              next: '@namespace',
            },
            '@keywords': {
              token: 'keyword.$0',
              next: '@qualified',
            },
            '@default': { token: 'identifier', next: '@qualified' },
          },
        },
      ],
      // whitespace
      { include: '@whitespace' },
      // delimiters and operators
      [
        /}/,
        {
          cases: {
            '$S2==interpolatedstring': {
              token: 'string.quote',
              next: '@pop',
            },
            '$S2==litinterpstring': {
              token: 'string.quote',
              next: '@pop',
            },
            '@default': '@brackets',
          },
        },
      ],
      [/[{}()[\]]/, '@brackets'],
      [/[<>](?!@symbols)/, '@brackets'],
      [
        /@symbols/,
        {
          cases: {
            '@operators': 'delimiter',
            '@default': '',
          },
        },
      ],
      // numbers
      [/[0-9_]*\.[0-9_]+([eE][-+]?\d+)?[fFdD]?/, 'number.float'],
      [/0[xX][0-9a-fA-F_]+/, 'number.hex'],
      [/0[bB][01_]+/, 'number.hex'],
      // binary: use same theme style as hex
      [/[0-9_]+/, 'number'],
      // delimiter: after number because of .\d floats
      [/[;,.]/, 'delimiter'],
      // strings
      [/"([^"\\]|\\.)*$/, 'string.invalid'],
      // non-teminated string
      [/"/, { token: 'string.quote', next: '@string' }],
      [/\$@"/, { token: 'string.quote', next: '@litinterpstring' }],
      [/@"/, { token: 'string.quote', next: '@litstring' }],
      [/\$"/, { token: 'string.quote', next: '@interpolatedstring' }],
      // characters
      [/'[^\\']'/, 'string'],
      [/(')(@escapes)(')/, ['string', 'string.escape', 'string']],
      [/'/, 'string.invalid'],
    ],
    qualified: [
      [
        /[a-zA-Z_][\w]*/,
        {
          cases: {
            '@keywords': { token: 'keyword.$0' },
            '@default': 'identifier',
          },
        },
      ],
      [/\./, 'delimiter'],
      ['', '', '@pop'],
    ],
    namespace: [
      { include: '@whitespace' },
      [/[A-Z]\w*/, 'namespace'],
      [/[.=]/, 'delimiter'],
      ['', '', '@pop'],
    ],
    comment: [
      [/[^/*]+/, 'comment'],
      // [/\/\*/,    'comment', '@push' ],    // no nested comments :-(
      ['\\*/', 'comment', '@pop'],
      [/[/*]/, 'comment'],
    ],
    string: [
      [/[^\\"]+/, 'string'],
      [/@escapes/, 'string.escape'],
      [/\\./, 'string.escape.invalid'],
      [/"/, { token: 'string.quote', next: '@pop' }],
    ],
    litstring: [
      [/[^"]+/, 'string'],
      [/""/, 'string.escape'],
      [/"/, { token: 'string.quote', next: '@pop' }],
    ],
    litinterpstring: [
      [/[^"{]+/, 'string'],
      [/""/, 'string.escape'],
      [/{{/, 'string.escape'],
      [/}}/, 'string.escape'],
      [/{/, { token: 'string.quote', next: 'root.litinterpstring' }],
      [/"/, { token: 'string.quote', next: '@pop' }],
    ],
    interpolatedstring: [
      [/[^\\"{]+/, 'string'],
      [/@escapes/, 'string.escape'],
      [/\\./, 'string.escape.invalid'],
      [/{{/, 'string.escape'],
      [/}}/, 'string.escape'],
      [/{/, { token: 'string.quote', next: 'root.interpolatedstring' }],
      [/"/, { token: 'string.quote', next: '@pop' }],
    ],
    whitespace: [
      [/^[ \t\v\f]*#((r)|(load))(?=\s)/, 'directive.csx'],
      [/^[ \t\v\f]*#\w.*$/, 'namespace.cpp'],
      [/[ \t\v\f\r\n]+/, ''],
      [/\/\*/, 'comment', '@comment'],
      [/\/\/.*$/, 'comment'],
    ],
  },
};

/**
 * Gets the C# grammar, exposed for the spec that tokenizes against it.
 * @returns Returns the grammar.
 */
export function csharpGrammar(): MonacoApi.languages.IMonarchLanguage {
  return CSHARP_GRAMMAR;
}

/**
 * Replaces Monaco's C# grammar with {@link CSHARP_GRAMMAR}. A directly registered tokens provider takes
 * precedence over the lazily loaded one Monaco registers for the language, so Monaco's own grammar is
 * never fetched; its language configuration (brackets, comments, folding markers) still is, and is
 * unaffected. A no-op when Monaco has not loaded.
 * @param monaco The loaded Monaco namespace, or undefined when it has not loaded yet.
 * @param realm The window the instance was loaded into, when it is not this one: the grammar's
 * regular expressions are rebuilt there, since Monaco refuses another window's.
 */
export function registerCsharpLanguage(
  monaco: typeof MonacoApi | undefined,
  realm: Window | undefined = undefined,
): void {
  if (monaco === undefined) {
    return;
  }
  monaco.languages.setMonarchTokensProvider(
    CSHARP_LANGUAGE_ID,
    realm === undefined ? CSHARP_GRAMMAR : inRealm(CSHARP_GRAMMAR, realm),
  );
}
