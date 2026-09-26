import type * as MonacoApi from 'monaco-editor';
import { inRealm } from './monaco-realm';

/**
 * Specifies the Monaco language identifier for SCSS.
 */
export const SCSS_LANGUAGE_ID: string = 'scss';

/**
 * Ends a keyword. Stricter than `\b`, which a hyphen satisfies: `@for` must not match the start of
 * `@forward`, nor `show` the start of a member named `show-button`.
 */
const END: string = '(?![\\w-])';

/**
 * The CSS at-rules that take a prelude and then either a block or a terminating semicolon, such as
 * `@media screen { … }` or `@layer base, components;`.
 */
const CSS_AT_RULES: string =
  'media|supports|container|layer|scope|starting-style|property|counter-style|font-feature-values|font-palette-values|document|-moz-document';

/**
 * A Monarch grammar for SCSS, replacing the one Monaco ships.
 *
 * Derived from `monaco-editor`'s SCSS grammar (MIT), which predates Sass's module system and matches its
 * at-keywords without a word boundary: `@forward` read as the control keyword `@for` followed by a
 * selector named `ward`, and `@use`, `@error`, `@at-root` and the newer CSS at-rules were not recognised
 * at all. This version bounds every at-keyword, adds the module rules (`@use`/`@forward` with their
 * `as`, `with`, `show` and `hide` clauses), namespaced members (`math.div()`, `math.$pi`,
 * `@include mixins.card`), `@error` alongside `@warn`/`@debug` (including inside functions), `@at-root`,
 * the `!global` flag, the modern CSS at-rules, and a fallback that reads any other at-rule as a keyword
 * rather than as a selector. Token names are the ones Monaco's grammar emits, so the application's
 * themes colour it without change.
 */
const SCSS_GRAMMAR: MonacoApi.languages.IMonarchLanguage = {
  defaultToken: '',
  tokenPostfix: '.scss',
  ws: '[ \t\n\r\f]*',
  identifier:
    '-?-?([a-zA-Z]|(\\\\(([0-9a-fA-F]{1,6}\\s?)|[^[0-9a-fA-F])))([\\w\\-]|(\\\\(([0-9a-fA-F]{1,6}\\s?)|[^[0-9a-fA-F])))*',
  brackets: [
    { open: '{', close: '}', token: 'delimiter.curly' },
    { open: '[', close: ']', token: 'delimiter.bracket' },
    { open: '(', close: ')', token: 'delimiter.parenthesis' },
    { open: '<', close: '>', token: 'delimiter.angle' },
  ],
  tokenizer: {
    root: [{ include: '@selector' }],
    selector: [
      { include: '@comments' },
      { include: '@module' },
      { include: '@import' },
      { include: '@variabledeclaration' },
      { include: '@warndebug' },
      [`[@](include)${END}`, { token: 'keyword', next: '@includedeclaration' }],
      [
        `[@](keyframes|-webkit-keyframes|-moz-keyframes|-o-keyframes)${END}`,
        { token: 'keyword', next: '@keyframedeclaration' },
      ],
      [`[@](page|content|font-face|at-root)${END}`, { token: 'keyword' }],
      [`[@](charset|namespace)${END}`, { token: 'keyword', next: '@declarationbody' }],
      [`[@](function)${END}`, { token: 'keyword', next: '@functiondeclaration' }],
      [`[@](mixin)${END}`, { token: 'keyword', next: '@mixindeclaration' }],
      [`[@](${CSS_AT_RULES})${END}`, { token: 'keyword', next: '@atruledeclaration' }],
      ['url(\\-prefix)?\\(', { token: 'meta', next: '@urldeclaration' }],
      { include: '@controlstatement' },
      // Any other at-rule is still an at-rule, not a selector.
      ['[@]@identifier', { token: 'keyword', next: '@atruledeclaration' }],
      { include: '@selectorname' },
      ['[&\\*]', 'tag'],
      ['[>\\+,~]', 'delimiter'],
      ['\\[', { token: 'delimiter.bracket', next: '@selectorattribute' }],
      ['{', { token: 'delimiter.curly', next: '@selectorbody' }],
    ],
    selectorbody: [
      // A declaration, told from a nested selector by the whitespace, number or semicolon after the colon.
      ['[*_]?@identifier@ws:(?=(\\s|\\d|[^{;}]*[;}]))', 'attribute.name', '@rulevalue'],
      [`[@](extend)${END}`, { token: 'keyword', next: '@extendbody' }],
      [`[@](return)${END}`, { token: 'keyword', next: '@declarationbody' }],
      { include: '@selector' },
      ['}', { token: 'delimiter.curly', next: '@pop' }],
    ],
    selectorname: [
      ['#{', { token: 'meta', next: '@variableinterpolation' }],
      ['(\\.|#(?=[^{])|%|(@identifier)|:)+', 'tag'],
    ],
    selectorattribute: [{ include: '@term' }, [']', { token: 'delimiter.bracket', next: '@pop' }]],
    term: [
      { include: '@comments' },
      ['url(\\-prefix)?\\(', { token: 'meta', next: '@urldeclaration' }],
      { include: '@functioninvocation' },
      { include: '@numbers' },
      { include: '@strings' },
      { include: '@variablereference' },
      ['(and\\b|or\\b|not\\b)', 'operator'],
      { include: '@name' },
      ['([<>=\\+\\-\\*\\/\\^\\|\\~,])', 'operator'],
      [',', 'delimiter'],
      [`!(default|global|optional)${END}`, 'literal'],
      ['\\(', { token: 'delimiter.parenthesis', next: '@parenthizedterm' }],
    ],
    rulevalue: [
      { include: '@term' },
      ['!important', 'literal'],
      [';', 'delimiter', '@pop'],
      // Nested properties, as in `font: { family: … }`.
      ['{', { token: 'delimiter.curly', switchTo: '@nestedproperty' }],
      // A missing semicolon before the closing brace.
      ['(?=})', { token: '', next: '@pop' }],
    ],
    nestedproperty: [
      ['[*_]?@identifier@ws:', 'attribute.name', '@rulevalue'],
      { include: '@comments' },
      ['}', { token: 'delimiter.curly', next: '@pop' }],
    ],
    warndebug: [[`[@](warn|debug|error)${END}`, { token: 'keyword', next: '@declarationbody' }]],
    import: [[`[@](import)${END}`, { token: 'keyword', next: '@declarationbody' }]],
    module: [[`[@](use|forward)${END}`, { token: 'keyword', next: '@moduledeclaration' }]],
    moduledeclaration: [
      [`(as|with|show|hide)${END}`, 'keyword'],
      { include: '@comments' },
      { include: '@strings' },
      ['\\(', { token: 'delimiter.parenthesis', next: '@moduleconfiguration' }],
      ['\\$@identifier', 'variable.ref'],
      ['@identifier', 'attribute.value'],
      ['[*]', 'operator'],
      [',', 'delimiter'],
      [';', 'delimiter', '@pop'],
      ['(?=})', { token: '', next: '@pop' }],
    ],
    moduleconfiguration: [
      ['\\$@identifier@ws:', 'variable.decl'],
      { include: '@term' },
      ['\\)', { token: 'delimiter.parenthesis', next: '@pop' }],
    ],
    variabledeclaration: [['\\$@identifier@ws:', 'variable.decl', '@declarationbody']],
    urldeclaration: [
      { include: '@strings' },
      ['[^)\r\n]+', 'string'],
      ['\\)', { token: 'meta', next: '@pop' }],
    ],
    parenthizedterm: [
      { include: '@term' },
      ['\\)', { token: 'delimiter.parenthesis', next: '@pop' }],
    ],
    declarationbody: [
      { include: '@term' },
      [';', 'delimiter', '@pop'],
      ['(?=})', { token: '', next: '@pop' }],
    ],
    atruledeclaration: [
      { include: '@term' },
      [':', 'delimiter'],
      [';', 'delimiter', '@pop'],
      ['{', { token: 'delimiter.curly', switchTo: '@selectorbody' }],
      ['(?=})', { token: '', next: '@pop' }],
    ],
    extendbody: [
      { include: '@selectorname' },
      ['!optional', 'literal'],
      [';', 'delimiter', '@pop'],
      ['(?=})', { token: '', next: '@pop' }],
    ],
    variablereference: [
      // A module member, as in `math.$pi`.
      ['@identifier\\.\\$@identifier', 'variable.ref'],
      ['\\$@identifier', 'variable.ref'],
      ['\\.\\.\\.', 'operator'],
      ['#{', { token: 'meta', next: '@variableinterpolation' }],
    ],
    variableinterpolation: [
      { include: '@variablereference' },
      ['}', { token: 'meta', next: '@pop' }],
    ],
    comments: [
      ['\\/\\*', 'comment', '@comment'],
      ['\\/\\/+.*', 'comment'],
    ],
    comment: [
      ['\\*\\/', 'comment', '@pop'],
      ['.', 'comment'],
    ],
    name: [['@identifier', 'attribute.value']],
    numbers: [
      ['(\\d*\\.)?\\d+([eE][\\-+]?\\d+)?', { token: 'number', next: '@units' }],
      ['#[0-9a-fA-F_]+(?!\\w)', 'number.hex'],
    ],
    units: [
      [
        '(em|ex|ch|rem|fr|vmin|vmax|vw|vh|vm|cm|mm|in|px|pt|pc|deg|grad|rad|turn|s|ms|Hz|kHz|%)?',
        'number',
        '@pop',
      ],
    ],
    functiondeclaration: [
      ['@identifier@ws\\(', { token: 'meta', next: '@parameterdeclaration' }],
      ['{', { token: 'delimiter.curly', switchTo: '@functionbody' }],
    ],
    mixindeclaration: [
      ['@identifier@ws\\(', { token: 'meta', next: '@parameterdeclaration' }],
      ['@identifier', 'meta'],
      ['{', { token: 'delimiter.curly', switchTo: '@selectorbody' }],
    ],
    parameterdeclaration: [
      ['\\$@identifier@ws:', 'variable.decl'],
      ['\\.\\.\\.', 'operator'],
      [',', 'delimiter'],
      { include: '@term' },
      ['\\)', { token: 'meta', next: '@pop' }],
    ],
    includedeclaration: [
      { include: '@functioninvocation' },
      // `@include card using ($args) { … }` passes arguments to the mixin's content block.
      [`using${END}`, 'keyword'],
      ['(@identifier\\.)?@identifier', 'meta'],
      ['\\(', { token: 'delimiter.parenthesis', next: '@parameterdeclaration' }],
      [';', 'delimiter', '@pop'],
      ['(?=})', { token: '', next: '@pop' }],
      ['{', { token: 'delimiter.curly', switchTo: '@selectorbody' }],
    ],
    keyframedeclaration: [
      ['@identifier', 'meta'],
      ['{', { token: 'delimiter.curly', switchTo: '@keyframebody' }],
    ],
    keyframebody: [
      { include: '@term' },
      ['{', { token: 'delimiter.curly', next: '@selectorbody' }],
      ['}', { token: 'delimiter.curly', next: '@pop' }],
    ],
    controlstatement: [
      [
        `[@](if|else|for|while|each)${END}`,
        { token: 'keyword.flow', next: '@controlstatementdeclaration' },
      ],
    ],
    controlstatementdeclaration: [
      [`(in|from|through|if|to)${END}`, { token: 'keyword.flow' }],
      { include: '@term' },
      ['{', { token: 'delimiter.curly', switchTo: '@selectorbody' }],
    ],
    functionbody: [
      [`[@](return)${END}`, { token: 'keyword', next: '@declarationbody' }],
      { include: '@warndebug' },
      { include: '@variabledeclaration' },
      { include: '@controlstatement' },
      { include: '@term' },
      [';', 'delimiter'],
      ['}', { token: 'delimiter.curly', next: '@pop' }],
    ],
    functioninvocation: [
      ['(@identifier\\.)?@identifier\\(', { token: 'meta', next: '@functionarguments' }],
    ],
    functionarguments: [
      ['\\$@identifier@ws:', 'attribute.name'],
      ['[,]', 'delimiter'],
      { include: '@term' },
      ['\\)', { token: 'meta', next: '@pop' }],
    ],
    strings: [
      ['~?"', { token: 'string.delimiter', next: '@stringenddoublequote' }],
      ["~?'", { token: 'string.delimiter', next: '@stringendquote' }],
    ],
    stringenddoublequote: [
      ['\\\\.', 'string'],
      ['"', { token: 'string.delimiter', next: '@pop' }],
      ['.', 'string'],
    ],
    stringendquote: [
      ['\\\\.', 'string'],
      ["'", { token: 'string.delimiter', next: '@pop' }],
      ['.', 'string'],
    ],
  },
};

/**
 * Gets the SCSS grammar, exposed for the spec that tokenizes against it.
 * @returns Returns the grammar.
 */
export function scssGrammar(): MonacoApi.languages.IMonarchLanguage {
  return SCSS_GRAMMAR;
}

/**
 * Replaces Monaco's SCSS grammar with {@link SCSS_GRAMMAR}. A directly registered tokens provider takes
 * precedence over the lazily loaded one Monaco registers for the language, so Monaco's own grammar is
 * never fetched; its language configuration (brackets, comments, folding markers) still is, and is
 * unaffected. A no-op when Monaco has not loaded.
 * @param monaco The loaded Monaco namespace, or undefined when it has not loaded yet.
 * @param realm The window the instance was loaded into, when it is not this one: the grammar's
 * regular expressions are rebuilt there, since Monaco refuses another window's.
 */
export function registerScssLanguage(
  monaco: typeof MonacoApi | undefined,
  realm: Window | undefined = undefined,
): void {
  if (monaco === undefined) {
    return;
  }
  monaco.languages.setMonarchTokensProvider(
    SCSS_LANGUAGE_ID,
    realm === undefined ? SCSS_GRAMMAR : inRealm(SCSS_GRAMMAR, realm),
  );
}
