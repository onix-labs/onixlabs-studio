import { MarkdownBlock, renderMarkdownBlocks, resetMarkdownCache } from './markdown-blocks';

/**
 * A document exercising every top-level construct the transcript renders, so the cache is proved
 * against real markdown rather than plain paragraphs alone.
 */
const KITCHEN_SINK: string = [
  '## A heading',
  '',
  'A paragraph with `code`, **emphasis**, [a link](https://example.test) and $E = mc^2$ math.',
  '',
  '- first item',
  '- second item with `code`',
  '',
  '| a | b |',
  '| - | - |',
  '| 1 | 2 |',
  '',
  '> quoted text with **bold**',
  '',
  '```ts',
  'const x: number = 1;',
  '```',
  '',
  'A closing paragraph.',
  '',
].join('\n');

describe('markdown-blocks', () => {
  beforeEach(() => {
    resetMarkdownCache();
  });

  it('renderMarkdownBlocks_whenTextIsEmpty_returnsNoBlocks', () => {
    expect(renderMarkdownBlocks('')).toEqual([]);
  });

  it('renderMarkdownBlocks_whenProseSurroundsAFence_splitsThemIntoOrderedBlocks', () => {
    const blocks: MarkdownBlock[] = renderMarkdownBlocks(
      'Before\n\n```js\nconst a = 1;\n```\n\nAfter',
    );

    expect(blocks.map((block: MarkdownBlock): string => block.kind)).toEqual([
      'html',
      'code',
      'html',
    ]);
    expect(blocks[1]).toEqual({ kind: 'code', code: 'const a = 1;', lang: 'js' });
  });

  it('renderMarkdownBlocks_whenARunHoldsSeveralTokens_emitsOneProseBlockPerToken', () => {
    // Block granularity is the cache granularity: the consumer binds one [innerHTML] per block, so a
    // settled token keeps its block (and its DOM) while a streaming flush only replaces the block of
    // the token still being written. Blank-line separators render to nothing and emit no block.
    const blocks: MarkdownBlock[] = renderMarkdownBlocks('## Title\n\nOne\n\nTwo\n');

    expect(blocks.map((block: MarkdownBlock): string => block.kind)).toEqual([
      'html',
      'html',
      'html',
    ]);
    const htmls: string[] = blocks.map(
      (block: MarkdownBlock): string => (block as { html: string }).html,
    );
    expect(htmls[0]).toContain('Title');
    expect(htmls[1]).toContain('One');
    expect(htmls[2]).toContain('Two');
  });

  it('renderMarkdownBlocks_whenAMessageStreams_keepsSettledBlocksIdentical', () => {
    // The point of per-token blocks: a growing tail must not change the earlier blocks' HTML, or the
    // consumer's identity-keyed wrappers (and the DOM behind them) rebuild on every flush anyway.
    const settled: MarkdownBlock[] = renderMarkdownBlocks('First paragraph.\n\nSecond is grow');
    const grown: MarkdownBlock[] = renderMarkdownBlocks('First paragraph.\n\nSecond is growing on');

    expect((grown[0] as { html: string }).html).toBe((settled[0] as { html: string }).html);
    expect((grown[1] as { html: string }).html).not.toBe((settled[1] as { html: string }).html);
  });

  it('renderMarkdownBlocks_whenCalledAgain_rendersIdenticallyFromTheCache', () => {
    const first: MarkdownBlock[] = renderMarkdownBlocks(KITCHEN_SINK);
    const second: MarkdownBlock[] = renderMarkdownBlocks(KITCHEN_SINK);

    expect(second).toEqual(first);
  });

  it('renderMarkdownBlocks_whenTheCacheIsCleared_rendersTheSameOutput', () => {
    // The cache must be a pure memo: dropping it may only cost time, never change what is rendered.
    const cached: MarkdownBlock[] = renderMarkdownBlocks(KITCHEN_SINK);
    resetMarkdownCache();

    expect(renderMarkdownBlocks(KITCHEN_SINK)).toEqual(cached);
  });

  it('renderMarkdownBlocks_whenTextArrivesAsAStream_matchesAOneShotRenderAtEveryStep', () => {
    // The regression this cache exists for: a reply is re-rendered on every stream flush, each time
    // with one more character. Every prefix must render exactly as it would have on its own, or a
    // stale entry is leaking between the growing message and its settled blocks.
    for (let length: number = 1; length <= KITCHEN_SINK.length; length += 7) {
      const prefix: string = KITCHEN_SINK.slice(0, length);
      const streamed: MarkdownBlock[] = renderMarkdownBlocks(prefix);

      resetMarkdownCache();
      const fresh: MarkdownBlock[] = renderMarkdownBlocks(prefix);
      expect(streamed).toEqual(fresh);

      // Re-warm the cache with everything seen so far, as a real stream would leave it.
      renderMarkdownBlocks(prefix);
    }
  });

  it('renderMarkdownBlocks_whenTwoTextsShareNoBlocks_keepsTheirRendersDistinct', () => {
    const first: MarkdownBlock[] = renderMarkdownBlocks('Alpha paragraph.\n');
    const second: MarkdownBlock[] = renderMarkdownBlocks('Beta paragraph.\n');

    expect((first[0] as { html: string }).html).toContain('Alpha');
    expect((second[0] as { html: string }).html).toContain('Beta');
    expect((second[0] as { html: string }).html).not.toContain('Alpha');
  });

  it('renderMarkdownBlocks_whenABlockRepeatsAcrossMessages_rendersItIdentically', () => {
    // Two conversations (or two Mission Control mirrors of one) sharing a paragraph must render it
    // identically — that shared render is what makes a module-wide cache worth having. A fence keeps
    // the shared paragraph in a prose run of its own, so the comparison is of that block alone.
    const shared: string = 'A shared paragraph with **bold**.\n\n```sh\nls\n```\n\n';

    expect(renderMarkdownBlocks(`${shared}Tail one.\n`)[0]).toEqual(
      renderMarkdownBlocks(`${shared}Tail two.\n`)[0],
    );
  });

  it('renderMarkdownBlocks_whenAFenceIsStillOpen_rendersItAsProseUntilItCloses', () => {
    // A half-streamed fence lexes as a paragraph; once the closing fence arrives it must become a
    // real code block rather than staying stuck on the earlier cached render.
    const open: MarkdownBlock[] = renderMarkdownBlocks('```ts\nconst x = 1;\n');
    const closed: MarkdownBlock[] = renderMarkdownBlocks('```ts\nconst x = 1;\n```\n');

    expect(open.every((block: MarkdownBlock): boolean => block.kind === 'code')).toBe(true);
    expect(closed).toEqual([{ kind: 'code', code: 'const x = 1;', lang: 'ts' }]);
  });

  it('renderMarkdownBlocks_whenRawHtmlWrapsProse_keepsTheTagsNestedAcrossTheRun', () => {
    // A model can open a tag in one token and close it in a later one. Sanitising those tokens
    // separately would balance the tags inside each fragment and lose the wrapper, so a run holding
    // raw HTML is rendered whole.
    const html: string = (
      renderMarkdownBlocks('<details>\n\nInner paragraph.\n\n</details>\n')[0] as { html: string }
    ).html;

    expect(html).toContain('<details>');
    expect(html).toContain('Inner paragraph.');
    expect(html.indexOf('<details>')).toBeLessThan(html.indexOf('Inner paragraph.'));
    expect(html.indexOf('Inner paragraph.')).toBeLessThan(html.indexOf('</details>'));
  });

  it('renderMarkdownBlocks_whenMathIsPresent_rendersItThroughKatex', () => {
    const blocks: MarkdownBlock[] = renderMarkdownBlocks('Mass energy: $E = mc^2$.\n');

    expect((blocks[0] as { html: string }).html).toContain('katex');
  });
});
