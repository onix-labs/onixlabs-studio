import { describe, expect, it } from 'vitest';
import { isTranslationFile } from './is-translation-file';
import type { TranslationFile } from './translation-file';
import source from './messages.json';
import french from './messages.fr.json';
import spanish from './messages.es.json';
import german from './messages.de.json';
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
 * Lists a message's placeholders, in order: `{$NAME}` outside a plural and `{NAME}` inside one.
 * @param message The message.
 * @returns Returns the placeholders, sorted, since a translation may reorder them.
 */
function placeholders(message: string): readonly string[] {
  return [...message.matchAll(/\{\$?\w+\}/g)]
    .map((match: RegExpExecArray): string => match[0])
    .sort();
}

/**
 * Holds the English source messages.
 */
const SOURCE: TranslationFile = file(source);

describe.each([
  ['French', french],
  ['Spanish', spanish],
  ['German', german],
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
});

describe('Pseudo translations', () => {
  it('cover every source message', () => {
    expect(Object.keys(file(pseudo).translations).sort()).toEqual(
      Object.keys(SOURCE.translations).sort(),
    );
  });
});
