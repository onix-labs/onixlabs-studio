import DOMPurify from 'dompurify';
import katex from 'katex';
import { marked, Token, Tokens, TokenizerAndRendererExtension } from 'marked';

/**
 * Renders markdown into an ordered list of blocks: prose (as a sanitised HTML string) and fenced code
 * (kept as raw text for a dedicated component to render with copy/run actions). Math is rendered inline
 * in the prose HTML via KaTeX. Splitting code out is what lets the bubble attach interactive controls
 * to code fences, which a single `[innerHTML]` string cannot carry.
 *
 * The prose HTML is sanitised here with DOMPurify — which strips scripts and event handlers from the
 * model's output while KEEPING the inline positioning styles KaTeX depends on. Angular's own
 * `[innerHTML]` sanitiser strips those styles (collapsing math into overlapping glyphs), so the
 * consumer binds this already-safe HTML as trusted rather than letting Angular re-sanitise it.
 */

/**
 * A prose block: sanitised HTML produced by marked, with KaTeX math already rendered.
 */
export interface MarkdownHtmlBlock {
  /**
   * Identifies a prose block.
   */
  readonly kind: 'html';

  /**
   * Gets the HTML string.
   */
  readonly html: string;
}

/**
 * A fenced code block: its raw code and info-string language, rendered by a dedicated component.
 */
export interface MarkdownCodeBlock {
  /**
   * Identifies a code block.
   */
  readonly kind: 'code';

  /**
   * Gets the raw code content.
   */
  readonly code: string;

  /**
   * Gets the fence's info string (language), or an empty string when none was given.
   */
  readonly lang: string;
}

/**
 * A rendered markdown block.
 */
export type MarkdownBlock = MarkdownHtmlBlock | MarkdownCodeBlock;

/**
 * Renders a TeX string to KaTeX HTML, never throwing on malformed input (the source is left visible
 * instead). HTML-only output — the MathML a11y layer is dropped, since Angular's sanitiser would strip
 * it from the bound HTML anyway.
 * @param tex The TeX source.
 * @param display Whether to render in display (block) mode.
 * @returns Returns the KaTeX HTML.
 */
function renderMath(tex: string, display: boolean): string {
  return katex.renderToString(tex, { displayMode: display, throwOnError: false, output: 'html' });
}

/**
 * The block-math extension: `$$ … $$`, rendered as a display-mode KaTeX block.
 */
const blockMath: TokenizerAndRendererExtension = {
  name: 'blockMath',
  level: 'block',
  start(src: string): number | undefined {
    const index: number = src.indexOf('$$');
    return index === -1 ? undefined : index;
  },
  tokenizer(src: string): Tokens.Generic | undefined {
    const match: RegExpExecArray | null = /^\$\$([\s\S]+?)\$\$/.exec(src);
    if (match === null) {
      return undefined;
    }
    return { type: 'blockMath', raw: match[0], text: match[1].trim() };
  },
  renderer(token: Tokens.Generic): string {
    return renderMath(typeof token['text'] === 'string' ? token['text'] : '', true);
  },
};

/**
 * The inline-math extension: `$ … $`, rendered as an inline KaTeX span. The delimiters must hug their
 * content and the closing `$` must not be followed by a digit, so prose prices (`$5 and $10`) are not
 * mistaken for math.
 */
const inlineMath: TokenizerAndRendererExtension = {
  name: 'inlineMath',
  level: 'inline',
  start(src: string): number | undefined {
    const index: number = src.indexOf('$');
    return index === -1 ? undefined : index;
  },
  tokenizer(src: string): Tokens.Generic | undefined {
    const match: RegExpExecArray | null = /^\$(?![\s$])((?:[^$\n]|\\\$)+?)(?<![\s])\$(?!\d)/.exec(src);
    if (match === null) {
      return undefined;
    }
    return { type: 'inlineMath', raw: match[0], text: match[1].trim() };
  },
  renderer(token: Tokens.Generic): string {
    return renderMath(typeof token['text'] === 'string' ? token['text'] : '', false);
  },
};

/**
 * Holds whether the KaTeX extensions have been registered on the shared marked instance, so they are
 * installed exactly once.
 */
let extensionsRegistered: boolean = false;

/**
 * Registers the KaTeX math extensions on the shared marked instance, once.
 */
function ensureExtensions(): void {
  if (!extensionsRegistered) {
    marked.use({ extensions: [blockMath, inlineMath] });
    extensionsRegistered = true;
  }
}

/**
 * The most rendered blocks held in the render cache. One top-level markdown token — a paragraph, a
 * heading, a list, a table — is one entry, so a long assistant reply contributes a few hundred and an
 * all-day session settles well inside this.
 */
const BLOCK_CACHE_ENTRIES: number = 4_096;

/**
 * The most characters (sources plus rendered HTML) held in the render cache. A ceiling on characters
 * as well as entries is what keeps a handful of enormous blocks from pinning megabytes.
 */
const BLOCK_CACHE_CHARS: number = 4_000_000;

/**
 * Holds rendered top-level blocks keyed by their source, in least-recently-used order (a `Map` iterates
 * in insertion order, and a hit is re-inserted). See {@link renderToken} for why this exists.
 */
const blockCache: Map<string, string> = new Map<string, string>();

/**
 * Holds the total characters currently held in {@link blockCache}, so eviction need not re-measure.
 */
let blockCacheChars: number = 0;

/**
 * Renders one top-level markdown token to sanitised HTML, reusing an earlier render of the same source.
 *
 * This is the transcript's hot path, and the reason a long conversation crawled. A streaming reply
 * re-renders on every flush of the stream buffer (~60/s), and parsing plus sanitising the whole message
 * grows super-linearly with it — measured at ~15ms for an 8KB reply and ~300ms at 32KB, per render, per
 * mounted view. Past a few kilobytes the renderer cannot keep up with the stream at all, and the reply
 * getting longer only widens the gap; trimming the row build around it cannot touch that.
 *
 * A top-level token that has already been written never changes again, though — only the last one, the
 * paragraph the tokens are still arriving in, differs from flush to flush. Rendering token by token and
 * keying on the token's own source therefore reduces a re-render to that final token, whatever the
 * length of the message. Marked's parser concatenates top-level tokens and each renders a complete
 * element, so joining the per-token output is what parsing them in one call produces.
 *
 * The cache is module-wide rather than per component, so Mission Control's mirrors of one conversation
 * share a single render instead of each paying for their own.
 * @param token The top-level token to render.
 * @returns Returns the sanitised HTML.
 */
function renderToken(token: Token): string {
  return cached(token.type + ' ' + token.raw, (): string =>
    DOMPurify.sanitize(marked.parser([token])),
  );
}

/**
 * Looks a rendered fragment up by its source, rendering and storing it on a miss and evicting the
 * least-recently-used entries back within the cache's budget.
 * @param key The fragment's source, which identifies its rendering.
 * @param render Produces the HTML on a miss.
 * @returns Returns the sanitised HTML.
 */
function cached(key: string, render: () => string): string {
  const hit: string | undefined = blockCache.get(key);
  if (hit !== undefined) {
    // Re-insert so the entry counts as most-recently-used for eviction.
    blockCache.delete(key);
    blockCache.set(key, hit);
    return hit;
  }
  const html: string = render();
  blockCache.set(key, html);
  blockCacheChars += key.length + html.length;
  // Evict back within the budget, always keeping the newest entry so a single oversized block still
  // renders (it simply evicts everything else).
  while (
    blockCache.size > 1 &&
    (blockCache.size > BLOCK_CACHE_ENTRIES || blockCacheChars > BLOCK_CACHE_CHARS)
  ) {
    const oldest: string = blockCache.keys().next().value!;
    blockCacheChars -= oldest.length + (blockCache.get(oldest)?.length ?? 0);
    blockCache.delete(oldest);
  }
  return html;
}

/**
 * Renders one contiguous run of non-code tokens to sanitised HTML.
 *
 * Normally this is the per-token path: each token is rendered and cached on its own, and their output
 * is joined. A run carrying a raw HTML token is the exception — a model can open a tag in one token
 * and close it in a later one (a `<details>` wrapper around prose, say), and sanitising those tokens
 * separately would balance the tags within each fragment instead of across the run, changing the
 * nesting. Such a run is therefore rendered whole, exactly as it always was, and cached against the
 * run's own source so a settled one is still free to re-render.
 * @param group The tokens forming the run.
 * @returns Returns the sanitised HTML.
 */
function renderRun(group: readonly Token[]): string {
  if (group.some((token: Token): boolean => token.type === 'html')) {
    let key: string = '';
    for (const token of group) {
      key += token.type + ' ' + token.raw;
    }
    return cached(key, (): string => DOMPurify.sanitize(marked.parser(group as Token[])));
  }
  let html: string = '';
  for (const token of group) {
    html += renderToken(token);
  }
  return html;
}

/**
 * Empties the render cache. Rendering is a pure function of its input, so this only ever costs time —
 * it exists to isolate tests and to release memory on demand.
 */
export function resetMarkdownCache(): void {
  blockCache.clear();
  blockCacheChars = 0;
}

/**
 * Renders markdown text into its ordered blocks: fenced code blocks kept as raw text, everything else
 * (prose, lists, tables, block and inline math) rendered to HTML. Each contiguous run of non-code
 * tokens becomes one prose block, rendered token by token through a shared cache (see
 * {@link renderToken}) so re-rendering a streaming message only pays for the token still being written.
 * @param text The markdown text.
 * @returns Returns the blocks in document order.
 */
export function renderMarkdownBlocks(text: string): MarkdownBlock[] {
  if (text.length === 0) {
    return [];
  }
  ensureExtensions();
  const tokens: Token[] = marked.lexer(text);
  const blocks: MarkdownBlock[] = [];
  let group: Token[] = [];
  const flush: () => void = (): void => {
    if (group.length > 0) {
      blocks.push({ kind: 'html', html: renderRun(group) });
      group = [];
    }
  };
  for (const token of tokens) {
    if (token.type === 'code') {
      flush();
      const code: Tokens.Code = token as Tokens.Code;
      blocks.push({ kind: 'code', code: code.text, lang: code.lang ?? '' });
    } else {
      group.push(token);
    }
  }
  flush();
  return blocks;
}
