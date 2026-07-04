import { MarkdownEditor } from '@shared/angular/components/markdown-editor/markdown-editor';
import { Review } from '@features/markdown/angular/markdown-review/markdown-review';
import {
  ReviewIssue,
  ReviewSession,
} from '@features/markdown/angular/markdown-review/review-types';
import { REVEAL_CENTRE_DIVISOR, supportsHighlight, WORD_STEP } from './highlight-support';

/**
 * Sentinel returned by {@link String.indexOf} when no match is found.
 */
const NOT_FOUND: number = -1;

/**
 * Minimum source length used when computing a review reveal's proportional position, guarding against
 * division by zero on an empty document.
 */
const MIN_SOURCE_LENGTH: number = 1;

/**
 * CSS Custom Highlight registry name for a revealed review issue.
 */
const REVIEW_HIGHLIGHT_NAME: string = 'markdown-review-flag';

/**
 * Duration in milliseconds the review reveal highlight stays before it is cleared.
 */
const REVIEW_FLASH_DURATION: number = 1600;

/**
 * Holds a rendered text-node segment with the offset it starts at in the concatenated rendered text.
 */
interface RenderedSegment {
  /**
   * Gets the text node.
   */
  readonly node: Text;

  /**
   * Gets the segment's start offset in the concatenated rendered text.
   */
  readonly start: number;
}

/**
 * Drives the review session for one markdown editor: exposes the live source and an undoable
 * apply-suggestion seam to the {@link Review} service, and reveals a flagged issue by scrolling its
 * rendered text into view and briefly flashing it through the CSS Custom Highlight API. Holds no cached
 * pane or DOM — it reads the live editor through the supplied accessors, so its reveal always resolves
 * against the current rendered document even after a content-load recreate.
 */
export class ReviewReveal {
  /**
   * Holds the accessor for the live editor pane, re-read on every call.
   */
  private readonly paneOf: () => MarkdownEditor | undefined;

  /**
   * Holds the accessor for the editor's live scroll container.
   */
  private readonly scrollerOf: () => HTMLElement | null;

  /**
   * Holds the review service the source, edit, and reveal seam is registered with while active.
   */
  private readonly review: Review;

  /**
   * Holds the review session registered with the {@link Review} service while active, or null.
   */
  private reviewSession: ReviewSession | null = null;

  /**
   * Holds the pending timer that clears the review reveal highlight, or null when none is scheduled.
   */
  private reviewFlashTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Initialises the reveal over the given pane, scroller, and review service.
   * @param paneOf The accessor for the live editor pane.
   * @param scrollerOf The accessor for the editor's live scroll container.
   * @param review The review service.
   */
  public constructor(
    paneOf: () => MarkdownEditor | undefined,
    scrollerOf: () => HTMLElement | null,
    review: Review,
  ) {
    this.paneOf = paneOf;
    this.scrollerOf = scrollerOf;
    this.review = review;
  }

  /**
   * Registers this editor as the active review session, so the Review panel can read the live source,
   * apply suggestions, and reveal flagged ranges in this editor.
   */
  public register(): void {
    if (this.reviewSession !== null) {
      return;
    }
    this.reviewSession = {
      getSource: (): string => this.paneOf()?.getMarkdown() ?? '',
      applyEdit: (start: number, end: number, replacement: string): void =>
        this.applyReviewEdit(start, end, replacement),
      reveal: (issue: ReviewIssue): void => this.revealReviewIssue(issue),
    };
    this.review.registerSession(this.reviewSession);
  }

  /**
   * Unregisters this editor's review session and clears any active reveal highlight (and its timer).
   */
  public unregister(): void {
    if (this.reviewSession !== null) {
      this.review.unregisterSession(this.reviewSession);
      this.reviewSession = null;
    }
    this.clearReviewFlash();
  }

  /**
   * Applies a review suggestion by replacing the source range with the given text. The replacement is
   * computed against the serialised markdown (the same source the issue offsets were derived from),
   * then the whole document is re-parsed and swapped in a single, undoable transaction.
   * @param start The start offset of the range to replace.
   * @param end The end offset (exclusive) of the range to replace.
   * @param replacement The replacement text.
   */
  private applyReviewEdit(start: number, end: number, replacement: string): void {
    const pane: MarkdownEditor | undefined = this.paneOf();
    if (pane === undefined) {
      return;
    }
    const source: string = pane.getMarkdown();
    pane.replaceAll(source.slice(0, start) + replacement + source.slice(end));
  }

  /**
   * Scrolls the flagged text of a review issue into view and briefly highlights it. The flagged word
   * is located in the rendered text at the occurrence closest to the issue's proportional position in
   * the source (the rendered text differs from the markdown source, so this is an approximate match).
   * @param issue The issue to reveal.
   */
  private revealReviewIssue(issue: ReviewIssue): void {
    const root: HTMLElement | null = this.paneOf()?.getEditorView()?.dom ?? null;
    if (root === null || issue.word.length === 0) {
      return;
    }

    const walker: TreeWalker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const segments: RenderedSegment[] = [];
    let rendered: string = '';
    let node: Node | null = walker.nextNode();
    while (node !== null) {
      const textNode: Text = node as Text;
      segments.push({ node: textNode, start: rendered.length });
      rendered += textNode.textContent ?? '';
      node = walker.nextNode();
    }

    const sourceLength: number = Math.max(MIN_SOURCE_LENGTH, this.reviewSourceLength());
    const target: number = (issue.start / sourceLength) * rendered.length;
    let best: number = NOT_FOUND;
    let bestDelta: number = Number.POSITIVE_INFINITY;
    let found: number = rendered.indexOf(issue.word);
    while (found !== NOT_FOUND) {
      const delta: number = Math.abs(found - target);
      if (delta < bestDelta) {
        bestDelta = delta;
        best = found;
      }
      found = rendered.indexOf(issue.word, found + WORD_STEP);
    }
    if (best === NOT_FOUND) {
      return;
    }

    const range: Range | null = this.rangeFromRendered(segments, best, best + issue.word.length);
    if (range === null) {
      return;
    }
    this.scrollRangeIntoView(range);
    this.flashReviewRange(range);
  }

  /**
   * Gets the length of the editor's serialised markdown source, used to position a review reveal.
   * @returns Returns the source length, or zero when no editor is mounted.
   */
  private reviewSourceLength(): number {
    return this.paneOf()?.getMarkdown().length ?? 0;
  }

  /**
   * Scrolls the editor's scroll container so the given range is centred in view.
   * @param range The range to reveal.
   */
  private scrollRangeIntoView(range: Range): void {
    const scroller: HTMLElement | null = this.scrollerOf();
    if (scroller === null) {
      return;
    }
    const rect: DOMRect = range.getBoundingClientRect();
    const scrollerRect: DOMRect = scroller.getBoundingClientRect();
    scroller.scrollTo({
      top:
        scroller.scrollTop +
        (rect.top - scrollerRect.top) -
        scrollerRect.height / REVEAL_CENTRE_DIVISOR,
      behavior: 'smooth',
    });
  }

  /**
   * Builds a DOM range spanning the given rendered-text offsets.
   * @param segments The text-node segments with their start offsets.
   * @param start The start offset in the rendered text.
   * @param end The end offset (exclusive) in the rendered text.
   * @returns Returns the range, or null when it cannot be resolved.
   */
  private rangeFromRendered(
    segments: readonly RenderedSegment[],
    start: number,
    end: number,
  ): Range | null {
    const startSegment: RenderedSegment | undefined = this.segmentAt(segments, start);
    const endSegment: RenderedSegment | undefined = this.segmentAt(segments, end - WORD_STEP);
    if (startSegment === undefined || endSegment === undefined) {
      return null;
    }
    const range: Range = document.createRange();
    range.setStart(startSegment.node, start - startSegment.start);
    range.setEnd(endSegment.node, end - endSegment.start);
    return range;
  }

  /**
   * Finds the text-node segment containing a rendered-text offset.
   * @param segments The segments.
   * @param offset The rendered-text offset.
   * @returns Returns the containing segment, or undefined.
   */
  private segmentAt(
    segments: readonly RenderedSegment[],
    offset: number,
  ): RenderedSegment | undefined {
    let match: RenderedSegment | undefined;
    for (const segment of segments) {
      if (segment.start <= offset) {
        match = segment;
      } else {
        break;
      }
    }
    return match;
  }

  /**
   * Briefly highlights a range using the CSS Custom Highlight API, which paints over the rendered text
   * without mutating the editor's DOM or document. Clears any prior flash first. No-ops where the API
   * is unavailable (such as under unit tests).
   * @param range The range to flash.
   */
  private flashReviewRange(range: Range): void {
    if (!supportsHighlight()) {
      return;
    }
    this.clearReviewFlash();
    CSS.highlights.set(REVIEW_HIGHLIGHT_NAME, new Highlight(range));
    this.reviewFlashTimer = setTimeout((): void => {
      this.clearReviewFlash();
    }, REVIEW_FLASH_DURATION);
  }

  /**
   * Clears the review reveal highlight and its pending timer, if any.
   */
  private clearReviewFlash(): void {
    if (this.reviewFlashTimer !== null) {
      clearTimeout(this.reviewFlashTimer);
      this.reviewFlashTimer = null;
    }
    if (supportsHighlight()) {
      CSS.highlights.delete(REVIEW_HIGHLIGHT_NAME);
    }
  }
}
