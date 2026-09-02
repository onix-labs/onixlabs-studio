import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  InputSignal,
  Signal,
} from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { CodeBlock } from '@shared/angular/components/code-block/code-block';
import { MarkdownCodeBlock, renderMarkdownBlocks } from './markdown-blocks';

/**
 * A prose block ready to render: its HTML trusted (already sanitised with DOMPurify upstream), so
 * Angular binds it without re-sanitising and stripping KaTeX's inline styles.
 */
interface RenderedHtmlBlock {
  /**
   * Identifies a prose block.
   */
  readonly kind: 'html';

  /**
   * Gets the trusted HTML.
   */
  readonly safe: SafeHtml;
}

/**
 * A block ready for the template: prose (trusted HTML) or fenced code.
 */
type RenderedBlock = RenderedHtmlBlock | MarkdownCodeBlock;

/**
 * The most trusted prose blocks held in the wrapper cache, mirroring the render cache's entry budget.
 */
const TRUSTED_CACHE_ENTRIES: number = 4_096;

/**
 * The most characters held in the wrapper cache. Each entry retains its HTML string (multi-token runs
 * re-join theirs on every render, so this cache holds the only lasting copy), and a character ceiling
 * keeps a handful of enormous blocks from pinning megabytes.
 */
const TRUSTED_CACHE_CHARS: number = 4_000_000;

/**
 * Holds trusted prose blocks keyed by their HTML, in least-recently-used order (a `Map` iterates in
 * insertion order, and a hit is re-inserted). See {@link trustedBlock} for why this exists.
 */
const trustedCache: Map<string, RenderedHtmlBlock> = new Map<string, RenderedHtmlBlock>();

/**
 * Holds the total characters currently held in {@link trustedCache}, so eviction need not re-measure.
 */
let trustedCacheChars: number = 0;

/**
 * Wraps prose HTML as a trusted block, reusing the wrapper an earlier render produced for the same
 * HTML.
 *
 * This is the DOM half of the streaming fix the render cache (see markdown-blocks) is the parse half
 * of: `[innerHTML]` re-parses its subtree whenever the bound value's IDENTITY changes, and wrapping
 * every block in a fresh `SafeHtml` per recompute rebuilt the whole streaming reply's DOM on every
 * flush (~30/s) even though the cached HTML strings were identical. Reusing the wrapper keeps a
 * settled block's binding identity stable, so only the block still being written re-renders. The
 * cache is module-wide, like the render cache, so Mission Control's mirrors of one conversation share
 * the wrappers too.
 * @param sanitizer The sanitiser that marks the (already DOMPurify-sanitised) HTML trusted.
 * @param html The sanitised HTML.
 * @returns Returns the trusted block.
 */
function trustedBlock(sanitizer: DomSanitizer, html: string): RenderedHtmlBlock {
  const hit: RenderedHtmlBlock | undefined = trustedCache.get(html);
  if (hit !== undefined) {
    // Re-insert so the entry counts as most-recently-used for eviction.
    trustedCache.delete(html);
    trustedCache.set(html, hit);
    return hit;
  }
  const block: RenderedHtmlBlock = { kind: 'html', safe: sanitizer.bypassSecurityTrustHtml(html) };
  trustedCache.set(html, block);
  trustedCacheChars += html.length;
  // Evict back within the budget, always keeping the newest entry so a single oversized block still
  // renders (it simply evicts everything else).
  while (
    trustedCache.size > 1 &&
    (trustedCache.size > TRUSTED_CACHE_ENTRIES || trustedCacheChars > TRUSTED_CACHE_CHARS)
  ) {
    const oldest: string = trustedCache.keys().next().value!;
    trustedCacheChars -= oldest.length;
    trustedCache.delete(oldest);
  }
  return block;
}

/**
 * Empties the wrapper cache. Wrapping is pure over its input, so this only ever costs time — it
 * exists to isolate tests.
 */
export function resetTrustedBlockCache(): void {
  trustedCache.clear();
  trustedCacheChars = 0;
}

/**
 * Renders markdown as a bubble body: prose (with KaTeX math) as sanitised HTML, and each fenced code
 * block as a {@link CodeBlock} with copy and — for shell commands — run actions. Splitting code out of
 * the HTML is what lets those interactive controls exist, which a single `[innerHTML]` string cannot
 * carry. Pure over its input, suitable for the many small, streaming assistant bubbles.
 */
@Component({
  selector: 'app-markdown-view',
  imports: [CodeBlock],
  templateUrl: './markdown-view.html',
  styleUrl: './markdown-view.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MarkdownView {
  /**
   * Gets the markdown text to render.
   */
  public readonly text: InputSignal<string | null | undefined> = input<string | null | undefined>(
    '',
  );

  /**
   * Holds the sanitiser used to bind the already-sanitised prose HTML as trusted.
   */
  private readonly sanitizer: DomSanitizer = inject(DomSanitizer);

  /**
   * Gets the rendered blocks in document order, prose HTML wrapped as trusted. Wrappers are reused
   * across recomputes for unchanged HTML (see {@link trustedBlock}), so a settled block's
   * `[innerHTML]` binding never sees a new identity and its DOM survives a streaming flush.
   */
  protected readonly blocks: Signal<readonly RenderedBlock[]> = computed(
    (): readonly RenderedBlock[] =>
      renderMarkdownBlocks(this.text() ?? '').map((block): RenderedBlock =>
        block.kind === 'html' ? trustedBlock(this.sanitizer, block.html) : block,
      ),
  );

  /**
   * Narrows a block to its prose form for the template.
   * @param block The block.
   * @returns Returns the HTML block.
   */
  protected asHtml(block: RenderedBlock): RenderedHtmlBlock {
    return block as RenderedHtmlBlock;
  }

  /**
   * Narrows a block to its code form for the template.
   * @param block The block.
   * @returns Returns the code block.
   */
  protected asCode(block: RenderedBlock): MarkdownCodeBlock {
    return block as MarkdownCodeBlock;
  }

  /**
   * Builds a stable tracking key for a block.
   * @param index The block index.
   * @returns Returns the tracking key.
   */
  protected trackBy(index: number): number {
    return index;
  }
}
