/**
 * A single spoken word within the read-along document.
 */
export interface ReadWord {
  /**
   * Gets the word text, including any attached punctuation.
   */
  readonly text: string;

  /**
   * Gets the zero-based position among all words in the document.
   */
  readonly globalIndex: number;

  /**
   * Gets the zero-based index of the paragraph this word belongs to.
   */
  readonly paragraphIndex: number;

  /**
   * Gets the zero-based, document-wide index of the sentence this word belongs to.
   */
  readonly sentenceIndex: number;

  /**
   * Gets the character offset of the word within its paragraph's spoken text.
   */
  readonly charOffset: number;
}

/**
 * A paragraph of the read-along document — the unit spoken as one utterance and the granularity of
 * skip-forward and skip-back.
 */
export interface ReadParagraph {
  /**
   * Gets the zero-based paragraph position.
   */
  readonly index: number;

  /**
   * Gets the flattened, plain text spoken for this paragraph.
   */
  readonly text: string;

  /**
   * Gets the global index of this paragraph's first word.
   */
  readonly startWord: number;

  /**
   * Gets the number of words in this paragraph.
   */
  readonly wordCount: number;
}

/**
 * A tokenised document ready for read-along playback and highlighting.
 */
export interface ReadDocument {
  /**
   * Gets the paragraphs in document order.
   */
  readonly paragraphs: readonly ReadParagraph[];

  /**
   * Gets every word in document order.
   */
  readonly words: readonly ReadWord[];

  /**
   * Gets the total number of words.
   */
  readonly totalWords: number;
}

/**
 * Zero (counts and comparisons).
 */
const ZERO: number = 0;

/**
 * One (increments).
 */
const ONE: number = 1;

/**
 * An empty tokenised document.
 */
export const EMPTY_DOCUMENT: ReadDocument = { paragraphs: [], words: [], totalWords: 0 };

/**
 * Matches a fenced code block delimited by triple backticks or tildes.
 */
const FENCED_CODE: RegExp = /```[\s\S]*?```|~~~[\s\S]*?~~~/g;

/**
 * Matches a markdown image, for example `![alt](url)`.
 */
const IMAGE: RegExp = /!\[[^\]]*\]\([^)]*\)/g;

/**
 * Matches a markdown link, capturing its visible text.
 */
const LINK: RegExp = /\[([^\]]*)\]\([^)]*\)/g;

/**
 * Matches inline-code backticks (the delimiters, not the content).
 */
const INLINE_CODE_TICKS: RegExp = /`+/g;

/**
 * Matches emphasis and strikethrough markers.
 */
const EMPHASIS: RegExp = /[*_~]+/g;

/**
 * Matches a leading blockquote, heading, or list marker on a line.
 */
const LINE_MARKER: RegExp = /^\s*(?:>+\s?|#{1,6}\s+|[-*+]\s+|\d+[.)]\s+)/;

/**
 * Matches an inline HTML tag.
 */
const HTML_TAG: RegExp = /<[^>]+>/g;

/**
 * Matches a table cell delimiter.
 */
const TABLE_PIPE: RegExp = /\|/g;

/**
 * Matches a horizontal rule line (`---`, `***`, `___`).
 */
const HORIZONTAL_RULE: RegExp = /^\s*([-*_])(?:\s*\1){2,}\s*$/;

/**
 * Matches a markdown table separator row (for example `|---|:--:|`).
 */
const TABLE_SEPARATOR: RegExp = /^\s*\|?[\s:|-]+\|?\s*$/;

/**
 * Matches one or more whitespace characters.
 */
const WHITESPACE: RegExp = /\s+/g;

/**
 * Matches a run of non-whitespace characters (a word).
 */
const WORD: RegExp = /\S+/g;

/**
 * Matches a word that ends a sentence (terminal punctuation, allowing trailing closing
 * quotes/brackets).
 */
const SENTENCE_END: RegExp = /[.!?]["')\]]*$/;

/**
 * Strips inline markdown formatting from a single line, leaving plain words.
 * @param line The raw markdown line (already free of block markers).
 * @returns Returns the cleaned line.
 */
function stripInline(line: string): string {
  return line
    .replace(IMAGE, ' ')
    .replace(LINK, '$1')
    .replace(HTML_TAG, ' ')
    .replace(INLINE_CODE_TICKS, '')
    .replace(EMPHASIS, '')
    .replace(TABLE_PIPE, ' ');
}

/**
 * Splits raw text into paragraph strings (groups of non-blank lines), removing markdown block markers
 * when {@link asMarkdown} is set.
 * @param text The source text.
 * @param asMarkdown Whether to strip markdown syntax.
 * @returns Returns the paragraph strings in document order.
 */
function toParagraphs(text: string, asMarkdown: boolean): string[] {
  const source: string = asMarkdown ? text.replace(FENCED_CODE, '\n\n') : text;
  const lines: string[] = source.split('\n');
  const paragraphs: string[] = [];
  let current: string[] = [];

  const flush: () => void = (): void => {
    if (current.length > ZERO) {
      const joined: string = current.join(' ').replace(WHITESPACE, ' ').trim();
      if (joined.length > ZERO) {
        paragraphs.push(joined);
      }
      current = [];
    }
  };

  for (const rawLine of lines) {
    if (rawLine.trim().length === ZERO) {
      flush();
      continue;
    }
    if (asMarkdown && (HORIZONTAL_RULE.test(rawLine) || TABLE_SEPARATOR.test(rawLine))) {
      continue;
    }
    const stripped: string = asMarkdown ? stripInline(rawLine.replace(LINE_MARKER, '')) : rawLine;
    if (stripped.trim().length > ZERO) {
      current.push(stripped.trim());
    }
  }
  flush();

  return paragraphs;
}

/**
 * Tokenises a document into paragraphs, sentences, and words for read-along playback. Markdown
 * content is stripped of formatting first; other content is read line-for-line.
 * @param content The document content.
 * @param asMarkdown Whether to treat the content as markdown.
 * @returns Returns the tokenised document.
 */
export function tokenizeDocument(content: string, asMarkdown: boolean): ReadDocument {
  const paragraphStrings: string[] = toParagraphs(content, asMarkdown);
  const paragraphs: ReadParagraph[] = [];
  const words: ReadWord[] = [];
  let sentenceIndex: number = ZERO;

  paragraphStrings.forEach((paragraphText: string, paragraphIndex: number): void => {
    if (paragraphIndex > ZERO) {
      sentenceIndex += ONE;
    }

    const startWord: number = words.length;
    let endsSentence: boolean = false;
    let match: RegExpExecArray | null;
    WORD.lastIndex = ZERO;

    while ((match = WORD.exec(paragraphText)) !== null) {
      if (endsSentence) {
        sentenceIndex += ONE;
        endsSentence = false;
      }
      words.push({
        text: match[0],
        globalIndex: words.length,
        paragraphIndex,
        sentenceIndex,
        charOffset: match.index,
      });
      if (SENTENCE_END.test(match[0])) {
        endsSentence = true;
      }
    }

    paragraphs.push({
      index: paragraphIndex,
      text: paragraphText,
      startWord,
      wordCount: words.length - startWord,
    });
  });

  return { paragraphs, words, totalWords: words.length };
}
