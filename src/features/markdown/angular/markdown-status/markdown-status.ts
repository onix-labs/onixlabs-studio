import { Service, signal, Signal, WritableSignal } from '@angular/core';

/**
 * Holds the average reading speed, in words per minute, used to estimate a document's read time.
 */
const WORDS_PER_MINUTE: number = 200;

/**
 * Describes a markdown document's derived statistics.
 */
export interface MarkdownStats {
  /**
   * Gets the number of whitespace-separated words in the document.
   */
  readonly words: number;

  /**
   * Gets the estimated read time in minutes (at least one minute for any non-empty document, zero
   * when empty).
   */
  readonly readMinutes: number;
}

/**
 * Computes a markdown document's word count and estimated read time from its raw content.
 * @param content The document's markdown text.
 * @returns Returns the derived statistics.
 */
export function computeMarkdownStats(content: string): MarkdownStats {
  const trimmed: string = content.trim();
  const words: number = trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
  const readMinutes: number = words === 0 ? 0 : Math.max(1, Math.round(words / WORDS_PER_MINUTE));
  return { words, readMinutes };
}

/**
 * Holds one markdown view's content for its status strip.
 *
 * Provided by the markdown view, so there is one instance per markdown tab and its lifetime is the
 * view's. The strip reaches it through the active view's injector and is torn down with the view, so
 * there is no owner key to collide with a sibling tab and nothing to clear on a tab switch.
 */
@Service()
export class MarkdownStatus {
  /**
   * Holds the view's editor content, or null before the editor's pane is ready.
   */
  private readonly contentSignal: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Gets the view's editor content, or null when it has nothing to report.
   */
  public readonly content: Signal<string | null> = this.contentSignal.asReadonly();

  /**
   * Publishes the view's editor content.
   * @param content The editor's markdown content.
   */
  public publish(content: string): void {
    this.contentSignal.set(content);
  }

  /**
   * Drops the view's content, so its status strip reports nothing.
   */
  public clear(): void {
    this.contentSignal.set(null);
  }
}
