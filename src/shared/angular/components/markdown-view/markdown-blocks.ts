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
 * Renders markdown text into its ordered blocks: fenced code blocks kept as raw text, everything else
 * (prose, lists, tables, block and inline math) rendered to HTML.
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
      blocks.push({ kind: 'html', html: DOMPurify.sanitize(marked.parser(group)) });
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
