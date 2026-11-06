import { undo } from '@milkdown/kit/prose/history';
import type { EditorView } from '@milkdown/kit/prose/view';
import { MarkdownEditor } from '@shared/angular/components/markdown-editor/markdown-editor';
import { Review } from '@features/markdown/angular/markdown-review/markdown-review';
import { applyReviewEdits } from '@features/markdown/angular/markdown-review/review-edits';
import {
  ReviewEdit,
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
 * rendered text into view and highlighting it through the CSS Custom Highlight API. Holds no cached
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
      applyEdits: (edits: readonly ReviewEdit[]): void => this.applyEdits(edits),
      undo: (): void => this.undo(),
      reveal: (issue: ReviewIssue): void => this.paintReviewIssue(issue, true),
      highlight: (issue: ReviewIssue): void => this.paintReviewIssue(issue, false),
      clearHighlight: (): void => this.clearReviewHighlight(),
    };
    this.review.registerSession(this.reviewSession);
  }

  /**
   * Unregisters this editor's review session and clears any active reveal highlight.
   */
  public unregister(): void {
    if (this.reviewSession !== null) {
      this.review.unregisterSession(this.reviewSession);
      this.reviewSession = null;
    }
    this.clearReviewHighlight();
  }

  /**
   * Applies review edits. They are computed against the serialised markdown (the same source the issue
   * offsets were derived from), then the whole document is re-parsed and swapped in a single, undoable
   * transaction. That transaction leaves the selection at the end of the document and scrolls to it, so
   * the scroll position is put back for the reveal of the next issue to start from here.
   * @param edits The edits to apply.
   */
  private applyEdits(edits: readonly ReviewEdit[]): void {
    const pane: MarkdownEditor | undefined = this.paneOf();
    if (pane === undefined) {
      return;
    }
    const scroller: HTMLElement | null = this.scrollerOf();
    const scrollTop: number = scroller?.scrollTop ?? 0;
    pane.replaceAll(applyReviewEdits(pane.getMarkdown(), edits));
    if (scroller !== null) {
      scroller.scrollTop = scrollTop;
    }
  }

  /**
   * Undoes the last step in the editor's history.
   */
  private undo(): void {
    const view: EditorView | null = this.paneOf()?.getEditorView() ?? null;
    if (view !== null) {
      undo(view.state, view.dispatch);
    }
  }

  /**
   * Highlights the flagged text of a review issue, optionally scrolling it into view. The flagged word
   * is located in the rendered text at the occurrence closest to the issue's proportional position in
   * the source (the rendered text differs from the markdown source, so this is an approximate match).
   * @param issue The issue to highlight.
   * @param scroll Whether to scroll the text into view.
   */
  private paintReviewIssue(issue: ReviewIssue, scroll: boolean): void {
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
      this.clearReviewHighlight();
      return;
    }

    const range: Range | null = this.rangeFromRendered(segments, best, best + issue.word.length);
    if (range === null) {
      this.clearReviewHighlight();
      return;
    }
    if (scroll) {
      this.scrollRangeIntoView(range);
    }
    this.highlightReviewRange(range);
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
   * Highlights a range using the CSS Custom Highlight API, which paints over the rendered text without
   * mutating the editor's DOM or document, replacing any prior highlight. No-ops where the API is
   * unavailable (such as under unit tests).
   * @param range The range to highlight.
   */
  private highlightReviewRange(range: Range): void {
    if (supportsHighlight()) {
      CSS.highlights.set(REVIEW_HIGHLIGHT_NAME, new Highlight(range));
    }
  }

  /**
   * Clears the review reveal highlight, if any.
   */
  private clearReviewHighlight(): void {
    if (supportsHighlight()) {
      CSS.highlights.delete(REVIEW_HIGHLIGHT_NAME);
    }
  }
}
