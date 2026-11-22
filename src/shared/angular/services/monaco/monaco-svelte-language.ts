import type * as MonacoApi from 'monaco-editor';
import { inRealm } from './monaco-realm';

/**
 * Specifies the Monaco language identifier for a Svelte component, the id svelte-language-server
 * serves (#1214). Monaco has no Svelte language of its own, so without this a `.svelte` file opened
 * as plain text: the server still started for it, but none of the hover, completion, highlight or
 * formatting providers registered for `svelte` ever matched the editor's model.
 */
export const SVELTE_LANGUAGE_ID: string = 'svelte';

/**
 * A Monarch grammar for Svelte components, after Monaco's own HTML grammar: markup, with the
 * `<script>` block coloured as TypeScript (which colours plain JavaScript too), the `<style>` block as
 * CSS, and Svelte's `{…}` expressions and `{#if}`, `{:else}`, `{/each}` blocks between. Token names are
 * HTML's, so the themes colour a component as they colour an HTML file.
 */
const SVELTE_GRAMMAR: MonacoApi.languages.IMonarchLanguage = {
  defaultToken: '',
  tokenPostfix: '.html',
  ignoreCase: true,
  blockKeywords: [
    'if',
    'else',
    'each',
    'await',
    'then',
    'catch',
    'key',
    'as',
    'html',
    'const',
    'debug',
    'snippet',
    'render',
  ],
  tokenizer: {
    root: [
      [/<!DOCTYPE/, 'metatag', '@doctype'],
      [/<!--/, 'comment', '@comment'],
      [/\{[#:/@]?/, 'delimiter.curly', '@expression'],
      [/(<)([\w\-:.]+)(\s*)(\/>)/, ['delimiter', 'tag', '', 'delimiter']],
      [/(<)(script)/, ['delimiter', { token: 'tag', next: '@script' }]],
      [/(<)(style)/, ['delimiter', { token: 'tag', next: '@style' }]],
      [/(<)([\w\-:.]+)/, ['delimiter', { token: 'tag', next: '@otherTag' }]],
      [/(<\/)([\w\-:.]+)/, ['delimiter', { token: 'tag', next: '@otherTag' }]],
      [/</, 'delimiter'],
      [/[^<{]+/, ''],
    ],
    expression: [
      [/\}/, 'delimiter.curly', '@pop'],
      [/\{/, 'delimiter.curly', '@push'],
      [/"([^"\\]|\\.)*"/, 'string'],
      [/'([^'\\]|\\.)*'/, 'string'],
      [/`[^`]*`/, 'string'],
      [/\d+(\.\d+)?/, 'number'],
      [/[a-z_$][\w$]*/, { cases: { '@blockKeywords': 'keyword', '@default': 'identifier' } }],
      [/[^}{"'`\w$]+/, 'delimiter'],
    ],
    doctype: [
      [/[^>]+/, 'metatag.content'],
      [/>/, 'metatag', '@pop'],
    ],
    comment: [
      // HTML also ends a comment at `--!>`, so colouring stops where the browser's comment does.
      [/--!?>/, 'comment', '@pop'],
      [/[^-]+/, 'comment.content'],
      [/./, 'comment.content'],
    ],
    otherTag: [
      [/\/?>/, 'delimiter', '@pop'],
      [/\{/, 'delimiter.curly', '@expression'],
      [/"([^"]*)"/, 'attribute.value'],
      [/'([^']*)'/, 'attribute.value'],
      [/[\w\-:|.]+/, 'attribute.name'],
      [/=/, 'delimiter'],
      [/[ \t\r\n]+/, ''],
    ],
    script: [
      [/"([^"]*)"/, 'attribute.value'],
      [/'([^']*)'/, 'attribute.value'],
      [/[\w\-:]+/, 'attribute.name'],
      [/=/, 'delimiter'],
      [/>/, { token: 'delimiter', next: '@scriptEmbedded', nextEmbedded: 'text/typescript' }],
      [/[ \t\r\n]+/, ''],
      [/(<\/)(script\s*)(>)/, ['delimiter', 'tag', { token: 'delimiter', next: '@pop' }]],
    ],
    scriptEmbedded: [
      [/<\/script/, { token: '@rematch', next: '@pop', nextEmbedded: '@pop' }],
      [/[^<]+/, ''],
    ],
    style: [
      [/"([^"]*)"/, 'attribute.value'],
      [/'([^']*)'/, 'attribute.value'],
      [/[\w\-:]+/, 'attribute.name'],
      [/=/, 'delimiter'],
      [/>/, { token: 'delimiter', next: '@styleEmbedded', nextEmbedded: 'text/css' }],
      [/[ \t\r\n]+/, ''],
      [/(<\/)(style\s*)(>)/, ['delimiter', 'tag', { token: 'delimiter', next: '@pop' }]],
    ],
    styleEmbedded: [
      [/<\/style/, { token: '@rematch', next: '@pop', nextEmbedded: '@pop' }],
      [/[^<]+/, ''],
    ],
  },
};

/**
 * Gets the Svelte grammar, exposed for the spec that checks it.
 * @returns Returns the grammar.
 */
export function svelteGrammar(): MonacoApi.languages.IMonarchLanguage {
  return SVELTE_GRAMMAR;
}

/**
 * Registers the Svelte language and its grammar with Monaco, so a `.svelte` file opens as Svelte and
 * svelte-language-server's hover, completion, highlights and formatting reach it (#1214). Idempotent,
 * and a no-op when Monaco has not loaded or already knows Svelte.
 * @param monaco The loaded Monaco namespace, or undefined when it has not loaded yet.
 * @param realm The window the instance was loaded into, when it is not this one: the grammar's
 * regular expressions are rebuilt there, since Monaco refuses another window's.
 */
export function registerSvelteLanguage(
  monaco: typeof MonacoApi | undefined,
  realm: Window | undefined = undefined,
): void {
  if (
    monaco === undefined ||
    monaco.languages
      .getLanguages()
      .some(
        (language: MonacoApi.languages.ILanguageExtensionPoint): boolean =>
          language.id === SVELTE_LANGUAGE_ID,
      )
  ) {
    return;
  }
  monaco.languages.register({
    id: SVELTE_LANGUAGE_ID,
    extensions: ['.svelte'],
    aliases: ['Svelte'],
  });
  monaco.languages.setMonarchTokensProvider(
    SVELTE_LANGUAGE_ID,
    realm === undefined ? SVELTE_GRAMMAR : inRealm(SVELTE_GRAMMAR, realm),
  );
  monaco.languages.setLanguageConfiguration(SVELTE_LANGUAGE_ID, {
    comments: { blockComment: ['<!--', '-->'] },
    brackets: [
      ['<!--', '-->'],
      ['<', '>'],
      ['{', '}'],
      ['(', ')'],
    ],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '"', close: '"' },
      { open: "'", close: "'" },
    ],
    surroundingPairs: [
      { open: '"', close: '"' },
      { open: "'", close: "'" },
      { open: '{', close: '}' },
      { open: '<', close: '>' },
    ],
  });
}
