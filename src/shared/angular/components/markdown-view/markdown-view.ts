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
   * Gets the rendered blocks in document order, prose HTML wrapped as trusted.
   */
  protected readonly blocks: Signal<readonly RenderedBlock[]> = computed(
    (): readonly RenderedBlock[] =>
      renderMarkdownBlocks(this.text() ?? '').map(
        (block): RenderedBlock =>
          block.kind === 'html'
            ? { kind: 'html', safe: this.sanitizer.bypassSecurityTrustHtml(block.html) }
            : block,
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
