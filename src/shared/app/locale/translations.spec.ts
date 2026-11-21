import { describe, expect, it } from 'vitest';
import { isTranslationFile } from './is-translation-file';
import type { TranslationFile } from './translation-file';
import source from './messages.json';
import french from './messages.fr.json';
import spanish from './messages.es.json';
import german from './messages.de.json';
import chinese from './messages.zh-Hans.json';
import arabic from './messages.ar.json';
import pseudo from './messages.pseudo.json';

/**
 * Reads a bundled translation file, failing the test when it is malformed.
 * @param value The file's content.
 * @returns Returns the file.
 */
function file(value: unknown): TranslationFile {
  if (!isTranslationFile(value)) {
    throw new Error('Not a translation file');
  }
  return value;
}

/**
 * Lists the placeholders a message uses: `{$NAME}` outside a plural and `{NAME}` inside one. Each is
 * listed once, since a translation may reorder them, and its plurals may have more or fewer cases
 * than English (Arabic has six) that each repeat a placeholder.
 * @param message The message.
 * @returns Returns the placeholders, sorted.
 */
function placeholders(message: string): readonly string[] {
  return [
    ...new Set<string>(
      [...message.matchAll(/\{\$?\w+\}/g)].map((match: RegExpExecArray): string => match[0]),
    ),
  ].sort();
}

/**
 * Lists the case keys of a message's plurals, such as `=1`, `few` and `other`.
 * @param message The message.
 * @returns Returns the keys, in order.
 */
function pluralCases(message: string): readonly string[] {
  const plural: RegExpExecArray | null = /^\{\w+, plural, (.*)\}$/s.exec(message);
  if (plural === null) {
    return [];
  }
  const keys: string[] = [];
  let depth: number = 0;
  let key: string = '';
  for (const character of plural[1] ?? '') {
    if (character === '{') {
      if (depth === 0) {
        keys.push(key.trim());
        key = '';
      }
      depth += 1;
    } else if (character === '}') {
      depth -= 1;
    } else if (depth === 0) {
      key += character;
    }
  }
  return keys;
}

/**
 * Determines whether a message's braces pair up, so a hand-edited plural cannot leave one open.
 * @param message The message.
 * @returns Returns true when every brace is closed in order.
 */
function isBalanced(message: string): boolean {
  let depth: number = 0;
  for (const character of message) {
    depth += character === '{' ? 1 : character === '}' ? -1 : 0;
    if (depth < 0) {
      return false;
    }
  }
  return depth === 0;
}

/**
 * Holds the English source messages.
 */
const SOURCE: TranslationFile = file(source);

describe.each([
  ['French', french],
  ['Spanish', spanish],
  ['German', german],
  ['Simplified Chinese', chinese],
  ['Arabic', arabic],
  ['Pseudo', pseudo],
])('%s translations', (_name: string, content: unknown) => {
  const translations: TranslationFile = file(content);

  it('translate only messages the source still has', () => {
    const stale: readonly string[] = Object.keys(translations.translations).filter(
      (id: string): boolean => !(id in SOURCE.translations),
    );
    expect(stale).toEqual([]);
  });

  it('keep every placeholder of the source message', () => {
    for (const [id, text] of Object.entries(translations.translations)) {
      expect(placeholders(text), id).toEqual(placeholders(SOURCE.translations[id] ?? ''));
    }
  });

  it('close every brace they open', () => {
    for (const [id, text] of Object.entries(translations.translations)) {
      expect(isBalanced(text), id).toBe(true);
    }
  });

  it('cover every source message', () => {
    const missing: readonly string[] = Object.keys(SOURCE.translations).filter(
      (id: string): boolean => !(id in translations.translations),
    );
    expect(missing).toEqual([]);
  });
});

describe.each([
  ['French', french],
  ['Spanish', spanish],
  ['German', german],
  ['Simplified Chinese', chinese],
  ['Arabic', arabic],
])('%s plurals', (_name: string, content: unknown) => {
  const translations: TranslationFile = file(content);
  const categories: readonly string[] = new Intl.PluralRules(
    translations.locale,
  ).resolvedOptions().pluralCategories;

  it('stay plurals where the source has one', () => {
    for (const [id, text] of Object.entries(SOURCE.translations)) {
      if (pluralCases(text).length > 0) {
        expect(pluralCases(translations.translations[id] ?? text).length, id).toBeGreaterThan(0);
      }
    }
  });

  it('use only the plural categories the language has, or exact values', () => {
    for (const [id, text] of Object.entries(translations.translations)) {
      for (const key of pluralCases(text)) {
        expect(/^=\d+$/.test(key) || categories.includes(key), `${id}: ${key}`).toBe(true);
      }
    }
  });

  it('give every plural an other case', () => {
    for (const [id, text] of Object.entries(translations.translations)) {
      const cases: readonly string[] = pluralCases(text);
      if (cases.length > 0) {
        expect(cases, id).toContain('other');
      }
    }
  });
});
