import { describe, it, expect } from 'vitest';

import { buildReadModel, EMPTY_MODEL, ReadModel } from './read-model';

/**
 * Builds a detached `.ProseMirror` root with the given inner HTML.
 * @param html The inner HTML.
 * @returns Returns the root element.
 */
function root(html: string): HTMLElement {
  const element: HTMLElement = document.createElement('div');
  element.className = 'ProseMirror';
  element.innerHTML = html;
  return element;
}

describe('buildReadModel', () => {
  it('buildReadModel_whenNullRoot_returnsEmptyModel', () => {
    expect(buildReadModel(null)).toBe(EMPTY_MODEL);
  });

  it('buildReadModel_whenParagraphs_collectsWordsWithRanges', () => {
    const model: ReadModel = buildReadModel(root('<p>Hello world</p><h1>Title</h1>'));
    expect(model.document.words.map((word): string => word.text)).toEqual([
      'Hello',
      'world',
      'Title',
    ]);
    expect(model.ranges.length).toBe(3);
    expect(model.ranges[0].toString()).toBe('Hello');
  });

  it('buildReadModel_whenCodeBlock_skipsItsText', () => {
    const model: ReadModel = buildReadModel(root('<p>keep this</p><pre><code>skipme</code></pre>'));
    const text: string[] = model.document.words.map((word): string => word.text);
    expect(text).toContain('keep');
    expect(text).not.toContain('skipme');
  });

  it('buildReadModel_whenSeparateBlocks_assignsSeparateParagraphs', () => {
    const model: ReadModel = buildReadModel(root('<p>one</p><p>two</p>'));
    expect(model.document.paragraphs.length).toBe(2);
    expect(model.document.words[0].paragraphIndex).toBe(0);
    expect(model.document.words[1].paragraphIndex).toBe(1);
  });
});
