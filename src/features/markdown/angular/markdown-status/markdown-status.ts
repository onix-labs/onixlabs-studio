import { Service, signal, Signal, WritableSignal } from '@angular/core';

/**
 * Holds the average reading speed, in words per minute, used to estimate a document's read time.
 */
const WORDS_PER_MINUTE: number = 200;

/**
 * Splits text into what a reader counts as characters: an emoji or an accented letter built from
 * several code points is one.
 */
const GRAPHEMES: Intl.Segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/**
 * Describes a markdown document's derived statistics.
 */
export interface MarkdownStats {
  /**
   * Gets the number of whitespace-separated words in the text.
   */
  readonly words: number;

  /**
   * Gets the number of characters in the text, spaces included and line breaks not.
   */
  readonly characters: number;

  /**
   * Gets the estimated read time in minutes (at least one minute for any non-empty text, zero when
   * empty).
   */
  readonly readMinutes: number;
}

/**
 * Computes the word count, character count and estimated read time of text — the text a reader sees,
 * not the markdown source, so a heading's `#` or a link's address is not counted as words (#882).
 * @param text The text to measure.
 * @returns Returns the derived statistics.
 */
export function computeMarkdownStats(text: string): MarkdownStats {
  const trimmed: string = text.trim();
  const words: number = trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
  const characters: number = [...GRAPHEMES.segment(text.replace(/[\r\n]/g, ''))].length;
  const readMinutes: number = words === 0 ? 0 : Math.max(1, Math.round(words / WORDS_PER_MINUTE));
  return { words, characters, readMinutes };
}

/**
 * What one markdown view reports to its status strip.
 */
export interface MarkdownContext {
  /**
   * Gets the document's path, or null while it is unsaved.
   */
  readonly path: string | null;

  /**
   * Gets the document's text as the editor shows it.
   */
  readonly text: string;

  /**
   * Gets the selected text, or null when nothing is selected.
   */
  readonly selectedText: string | null;
}

/**
 * Holds one markdown view's document for its status strip.
 *
 * Provided by the markdown view, so there is one instance per markdown tab and its lifetime is the
 * view's. The strip reaches it through the active view's injector and is torn down with the view, so
 * there is no owner key to collide with a sibling tab and nothing to clear on a tab switch.
 */
@Service()
export class MarkdownStatus {
  /**
   * Holds the view's document, or null before the editor's pane is ready.
   */
  private readonly contextSignal: WritableSignal<MarkdownContext | null> =
    signal<MarkdownContext | null>(null);

  /**
   * Gets the view's document, or null when it has nothing to report.
   */
  public readonly context: Signal<MarkdownContext | null> = this.contextSignal.asReadonly();

  /**
   * Publishes the view's document.
   * @param context The document's path, text and selection.
   */
  public publish(context: MarkdownContext): void {
    this.contextSignal.set(context);
  }

  /**
   * Drops the view's document, so its status strip reports nothing.
   */
  public clear(): void {
    this.contextSignal.set(null);
  }
}
