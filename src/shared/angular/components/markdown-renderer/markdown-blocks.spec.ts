import { marked, Token } from 'marked';
import { MockInstance } from 'vitest';

import {
  lexMarkdown,
  MarkdownBlock,
  renderMarkdownBlocks,
  resetMarkdownCache,
} from './markdown-blocks';

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

  it('renderMarkdownBlocks_stripsWhatCouldRestyleTheWindowOrTakeInput_butKeepsLinks', () => {
    // Audit S5: a model's reply shares the window with the permission card it might be asking about.
    const html: string = renderMarkdownBlocks(
      [
        '<style>body{display:none}</style>',
        '<form action="https://attacker.example"><input name="q"><button>go</button></form>',
        '',
        'See [the docs](https://example.test) and <img src="x" onerror="alert(1)">.',
      ].join('\n'),
    )
      .map((block: MarkdownBlock): string => (block.kind === 'html' ? block.html : ''))
      .join('');

    expect(html).not.toContain('<style');
    expect(html).not.toContain('<form');
    expect(html).not.toContain('<input');
    expect(html).not.toContain('onerror');
    expect(html).toContain('href="https://example.test"');
    expect(html).toContain('<img src="x">');
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

  // Every case here lexes or renders the reply once per character it streams, which is quick alone but
  // can outlast the default 5s budget when the whole suite shares the machine.
  describe('incremental lexing', { timeout: 30_000 }, () => {
    /**
     * A reply exercising the constructs whose meaning a later line can change, streamed so every one
     * of them is caught half-written: setext headings (`===` / `---` arriving under prose), a list
     * turning loose, a table whose header lands before its delimiter row, fences left open mid-stream
     * (backtick and tilde, one closed by a longer fence), indented code that cannot interrupt a
     * paragraph, lazy blockquote continuation, block math, and raw HTML.
     */
    const STREAMED: string = [
      '# Title',
      '',
      'An opening paragraph with **bold**, `code`, $x^2$ and a [link](https://example.test).',
      'It runs over two lines',
      '===',
      '',
      'Another paragraph that becomes',
      'a second-level heading',
      '---',
      '',
      '---',
      '',
      '- one',
      '- two',
      '',
      '- three, which makes the list loose',
      '  continued lazily',
      '',
      '1. first',
      '2. second',
      '   - nested',
      '',
      '| col a | col b |',
      '| :---- | ----: |',
      '| 1 | 2 |',
      '| 3 | 4 |',
      'trailing row text',
      '',
      '> a quote',
      'lazy continuation',
      '> > nested quote',
      '',
      '```ts',
      'const open: boolean = true;',
      '',
      'function f(): void {}',
      '```',
      '',
      'A paragraph',
      '    that indented code cannot interrupt',
      '',
      '    real indented code',
      '',
      '~~~~',
      'tilde fence',
      '~~~',
      'still inside',
      '~~~~~',
      '',
      '$$',
      'E = mc^2',
      '$$',
      '',
      'Prices like $5 and $$10 stay prose.',
      '',
      '<details>',
      '',
      'Inside **details**.',
      '',
      '</details>',
      '',
      'Term',
      ': not a definition list',
      '',
      '***',
      'Final paragraph with a trailing fence',
      '',
      '```',
      'never closed',
    ].join('\n');

    /**
     * Lexes text in one go, as the non-incremental path did — the reference every step must match.
     * @param text The markdown text.
     * @returns Returns the top-level tokens.
     */
    function fullLex(text: string): Token[] {
      return [...marked.Lexer.lex(text)];
    }

    /**
     * Streams a document in chunks, asserting the incremental lex equals a full lex at every step.
     * @param text The document.
     * @param sizes The chunk sizes, cycled.
     * @returns Returns how many steps re-lexed less than their whole text.
     */
    function streamAndCompare(text: string, sizes: readonly number[]): number {
      const lexer: MockInstance = vi.spyOn(marked, 'lexer');
      let partial: number = 0;
      let end: number = 0;
      let step: number = 0;
      try {
        while (end < text.length) {
          end = Math.min(text.length, end + sizes[step % sizes.length]);
          step++;
          const prefix: string = text.slice(0, end);
          lexer.mockClear();
          const tokens: Token[] = lexMarkdown(prefix);
          expect(tokens, `at offset ${end}`).toEqual(fullLex(prefix));
          if (
            lexer.mock.calls.every((call: unknown[]): boolean => (call[0] as string) !== prefix)
          ) {
            partial++;
          }
        }
      } finally {
        lexer.mockRestore();
      }
      return partial;
    }

    it('lexMarkdown_whenAReplyStreamsCharacterByCharacter_matchesAFullLexAtEveryStep', () => {
      const partial: number = streamAndCompare(STREAMED, [1]);

      // The point of the exercise: flushes re-lex only the tail. The exception is the prose `$$10`:
      // marked clips that paragraph at the block-math opener and splices the rest back on with a
      // newline that is not in the source, so token sources stop indexing the text and every flush
      // after it lexes whole (correct, just not faster).
      expect(partial).toBeGreaterThan(STREAMED.indexOf('$$10') * 0.95);
    });

    it('lexMarkdown_whenAReplyStreamsInUnevenChunks_matchesAFullLexAtEveryStep', () => {
      streamAndCompare(STREAMED, [7, 1, 23, 3, 64, 2, 11, 40, 5]);
      resetMarkdownCache();
      streamAndCompare(STREAMED + '\n\n' + KITCHEN_SINK, [13, 4, 31, 9]);
    });

    it('renderMarkdownBlocks_whenAReplyStreams_rendersWhatAFullLexRenders', () => {
      for (let end: number = 1; end <= STREAMED.length; end++) {
        const prefix: string = STREAMED.slice(0, end);
        const streamed: MarkdownBlock[] = renderMarkdownBlocks(prefix);
        // Forgetting every remembered lex forces the full path, which then seeds the next step.
        resetMarkdownCache();
        expect(streamed, `at offset ${end}`).toEqual(renderMarkdownBlocks(prefix));
      }
    });

    it('lexMarkdown_whenALaterDefinitionResolvesAnEarlierReference_matchesAFullLex', () => {
      // A reference definition reaches back across blocks: `[docs]` above only becomes a link once
      // the definition below arrives, so a stream that defines links must not reuse settled tokens.
      const text: string = [
        'See [docs] for more.',
        '',
        'Another paragraph.',
        '',
        '[docs]: https://example.test "Docs"',
        '',
        'And [docs] again, then more prose.',
        '',
        '[docs]: https://duplicate.test',
        '',
        'Last.',
      ].join('\n');

      streamAndCompare(text, [1]);
    });

    it('lexMarkdown_whenAnInlineTagStaysOpen_matchesAFullLex', () => {
      // An unclosed `<a …>` stops later paragraphs autolinking; `<code>` stops their escaping.
      const text: string = [
        'Open <a href="https://example.test"> anchor.',
        '',
        'A bare https://example.test url.',
        '',
        'Then <code> raw & text.',
        '',
        'More & more https://example.test text.',
      ].join('\n');

      streamAndCompare(text, [1]);
    });

    it('lexMarkdown_whenTheTextNoLongerExtendsThePrevious_lexesItWhole', () => {
      lexMarkdown('# One\n\nTwo\n\nThree\n\nFour');

      expect(lexMarkdown('# One\n\nTwo changed\n\nThree')).toEqual(
        fullLex('# One\n\nTwo changed\n\nThree'),
      );
    });

    it('lexMarkdown_whenTheTextHasCarriageReturns_matchesAFullLex', () => {
      streamAndCompare('# A\r\n\r\nFirst para\r\nline\r\n===\r\n\r\n- a\r\n- b\r\n', [1]);
    });
  });
});
