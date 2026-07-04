import { NgZone } from '@angular/core';
import { MarkdownEditor } from '@shared/angular/components/markdown-editor/markdown-editor';
import { Reader } from '@features/markdown/angular/markdown-reader/markdown-reader';
import {
  HighlightMode,
  ReadSession,
} from '@features/markdown/angular/markdown-reader/reader-types';
import { buildReadModel, ReadModel } from '@features/markdown/angular/markdown-reader/read-model';
import { ReadWord } from '@features/markdown/angular/markdown-reader/read-tokenize';
import { REVEAL_CENTRE_DIVISOR, supportsHighlight, WORD_STEP } from './highlight-support';

/**
 * CSS Custom Highlight registry name for the read-along spoken word.
 */
const READ_HIGHLIGHT_WORD: string = 'markdown-read-word';

/**
 * CSS Custom Highlight registry name for the read-along spoken sentence.
 */
const READ_HIGHLIGHT_SENTENCE: string = 'markdown-read-sentence';

/**
 * Comfort margin in pixels from the viewport edges within which the spoken word is considered visible
 * and does not trigger a follow scroll.
 */
const READ_REVEAL_MARGIN: number = 120;

/**
 * Drives the read-along session for one markdown editor: publishes the rendered word model to the
 * {@link Reader} while active, and paints the spoken word or sentence over the rendered text through
 * the CSS Custom Highlight API. Holds no cached pane or DOM — it reads the live editor through the
 * supplied accessors so its word ranges never point at an editor the recreation on content load has
 * replaced. The owning view drives its lifecycle (register/unregister) and re-publishes the model when
 * the document is recreated or edited.
 */
export class ReadAlongHighlighter {
  /**
   * Holds the accessor for the live editor pane, re-read on every call.
   */
  private readonly paneOf: () => MarkdownEditor | undefined;

  /**
   * Holds the accessor for the editor's live scroll container.
   */
  private readonly scrollerOf: () => HTMLElement | null;

  /**
   * Holds the Angular zone, used to publish the read model from outside change detection.
   */
  private readonly zone: NgZone;

  /**
   * Holds the reader service the read model and highlight seam are published to while active.
   */
  private readonly reader: Reader;

  /**
   * Holds the read session registered with the {@link Reader} service while active, or null.
   */
  private readSession: ReadSession | null = null;

  /**
   * Holds the words of the current read model, in rendered-DOM order.
   */
  private readWords: readonly ReadWord[] = [];

  /**
   * Holds a DOM range per read-model word, aligned to {@link readWords} by index.
   */
  private readWordRanges: readonly Range[] = [];

  /**
   * Initialises the highlighter over the given pane, scroller, zone, and reader.
   * @param paneOf The accessor for the live editor pane.
   * @param scrollerOf The accessor for the editor's live scroll container.
   * @param zone The Angular zone.
   * @param reader The reader service.
   */
  public constructor(
    paneOf: () => MarkdownEditor | undefined,
    scrollerOf: () => HTMLElement | null,
    zone: NgZone,
    reader: Reader,
  ) {
    this.paneOf = paneOf;
    this.scrollerOf = scrollerOf;
    this.zone = zone;
    this.reader = reader;
  }

  /**
   * Registers this editor as the active read session and publishes its rendered word model, so the
   * Reader panel can speak the document and highlight the spoken word here.
   */
  public register(): void {
    if (this.readSession !== null) {
      return;
    }
    this.readSession = {
      highlight: (index: number, mode: HighlightMode): void => this.highlightReadWord(index, mode),
      clearHighlight: (): void => this.clearReadHighlight(),
      revealWord: (index: number): void => this.revealReadWord(index),
    };
    this.reader.registerSession(this.readSession);
    this.publishModel();
  }

  /**
   * Clears any read-along highlight and unregisters this editor as the read session.
   */
  public unregister(): void {
    if (this.readSession === null) {
      return;
    }
    this.clearReadHighlight();
    this.reader.unregisterSession(this.readSession);
    this.readSession = null;
    this.readWords = [];
    this.readWordRanges = [];
  }

  /**
   * Builds the read-along model from the rendered document and publishes it to the reader, keeping the
   * local word ranges for in-document highlighting. Re-run on a document recreate or edit so the ranges
   * never address the replaced editor DOM.
   */
  public publishModel(): void {
    if (this.readSession === null) {
      return;
    }
    const root: HTMLElement | null = this.paneOf()?.getEditorView()?.dom ?? null;
    const model: ReadModel = buildReadModel(root);
    this.readWords = model.document.words;
    this.readWordRanges = model.ranges;
    this.zone.run((): void => this.reader.setDocument(model.document));
  }

  /**
   * Highlights the read-along word at the given index, or its sentence, using the CSS Custom Highlight
   * API, which paints over the rendered text without mutating ProseMirror's DOM.
   * @param wordIndex The word to highlight.
   * @param mode Whether to highlight the single word or its sentence.
   */
  private highlightReadWord(wordIndex: number, mode: HighlightMode): void {
    if (!supportsHighlight()) {
      return;
    }
    const word: ReadWord | undefined = this.readWords[wordIndex];
    const wordRange: Range | undefined = this.readWordRanges[wordIndex];
    if (word === undefined || wordRange === undefined) {
      this.clearReadHighlight();
      return;
    }
    if (mode === 'sentence') {
      CSS.highlights.set(
        READ_HIGHLIGHT_SENTENCE,
        new Highlight(this.sentenceRange(wordIndex, word.sentenceIndex)),
      );
      CSS.highlights.delete(READ_HIGHLIGHT_WORD);
    } else {
      CSS.highlights.set(READ_HIGHLIGHT_WORD, new Highlight(wordRange));
      CSS.highlights.delete(READ_HIGHLIGHT_SENTENCE);
    }
  }

  /**
   * Builds a DOM range spanning every word in the given sentence.
   * @param wordIndex A word within the sentence.
   * @param sentenceIndex The sentence index to span.
   * @returns Returns the sentence range.
   */
  private sentenceRange(wordIndex: number, sentenceIndex: number): Range {
    let start: number = wordIndex;
    let end: number = wordIndex;
    while (
      start - WORD_STEP >= 0 &&
      this.readWords[start - WORD_STEP].sentenceIndex === sentenceIndex
    ) {
      start -= WORD_STEP;
    }
    while (
      end + WORD_STEP < this.readWords.length &&
      this.readWords[end + WORD_STEP].sentenceIndex === sentenceIndex
    ) {
      end += WORD_STEP;
    }
    const startRange: Range = this.readWordRanges[start];
    const endRange: Range = this.readWordRanges[end];
    const range: Range = document.createRange();
    range.setStart(startRange.startContainer, startRange.startOffset);
    range.setEnd(endRange.endContainer, endRange.endOffset);
    return range;
  }

  /**
   * Clears the read-along highlight from the document.
   */
  private clearReadHighlight(): void {
    if (!supportsHighlight()) {
      return;
    }
    CSS.highlights.delete(READ_HIGHLIGHT_WORD);
    CSS.highlights.delete(READ_HIGHLIGHT_SENTENCE);
  }

  /**
   * Smoothly scrolls the spoken word into view when it drifts near or past the viewport edges, keeping
   * the read-along position comfortably visible.
   * @param wordIndex The word to reveal.
   */
  private revealReadWord(wordIndex: number): void {
    const range: Range | undefined = this.readWordRanges[wordIndex];
    const scroller: HTMLElement | null = this.scrollerOf();
    if (range === undefined || scroller === null) {
      return;
    }
    const rect: DOMRect = range.getBoundingClientRect();
    const scrollerRect: DOMRect = scroller.getBoundingClientRect();
    const aboveComfort: boolean = rect.top < scrollerRect.top + READ_REVEAL_MARGIN;
    const belowComfort: boolean = rect.bottom > scrollerRect.bottom - READ_REVEAL_MARGIN;
    if (!aboveComfort && !belowComfort) {
      return;
    }
    scroller.scrollTo({
      top:
        scroller.scrollTop +
        (rect.top - scrollerRect.top) -
        scrollerRect.height / REVEAL_CENTRE_DIVISOR,
      behavior: 'smooth',
    });
  }
}
