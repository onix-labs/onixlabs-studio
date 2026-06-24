import { describe, it, expect } from 'vitest';

import { ReadDocument, tokenizeDocument } from './read-tokenize';

describe('tokenizeDocument', () => {
  it('tokenizeDocument_whenParagraphs_splitsOnBlankLines', () => {
    const doc: ReadDocument = tokenizeDocument('Hello world\n\nSecond paragraph', true);
    expect(doc.paragraphs.length).toBe(2);
    expect(doc.totalWords).toBe(4);
  });

  it('tokenizeDocument_whenMarkdown_stripsHeadingAndEmphasisMarkers', () => {
    const doc: ReadDocument = tokenizeDocument('# **Title** here', true);
    expect(doc.words.map((word): string => word.text)).toEqual(['Title', 'here']);
  });

  it('tokenizeDocument_whenLink_keepsTheVisibleText', () => {
    const doc: ReadDocument = tokenizeDocument('see [the docs](https://example.com) now', true);
    expect(doc.words.map((word): string => word.text)).toEqual(['see', 'the', 'docs', 'now']);
  });

  it('tokenizeDocument_whenFencedCode_skipsIt', () => {
    const doc: ReadDocument = tokenizeDocument('before\n\n```\ncode here\n```\n\nafter', true);
    const text: string[] = doc.words.map((word): string => word.text);
    expect(text).toContain('before');
    expect(text).toContain('after');
    expect(text).not.toContain('code');
  });

  it('tokenizeDocument_whenSentenceEnds_incrementsSentenceIndex', () => {
    const doc: ReadDocument = tokenizeDocument('One two. Three four.', true);
    expect(doc.words[0].sentenceIndex).toBe(0);
    expect(doc.words[2].sentenceIndex).toBe(1);
  });

  it('tokenizeDocument_whenEmpty_hasNoWords', () => {
    expect(tokenizeDocument('   \n\n  ', true).totalWords).toBe(0);
  });
});
