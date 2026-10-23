import DOMPurify from 'dompurify';
import katex from 'katex';
import {
  marked,
  RendererExtension,
  RendererThis,
  Token,
  Tokens,
  TokenizerAndRendererExtension,
  TokensList,
} from 'marked';
import { Icon } from '@shared/angular/icons/icon';

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
    const match: RegExpExecArray | null = /^\$(?![\s$])((?:[^$\n]|\\\$)+?)(?<![\s])\$(?!\d)/.exec(
      src,
    );
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
 * The kinds of GitHub alert (`> [!NOTE]` and friends).
 */
type AlertType = 'note' | 'tip' | 'important' | 'warning' | 'caution';

/**
 * Matches a GitHub alert's marker, alone on a blockquote's first line, capturing its kind.
 */
const ALERT_MARKER: RegExp = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*(?:\n|$)/i;

/**
 * The icon each kind of alert carries, the same as the Markdown editor's.
 */
const ALERT_ICONS: Readonly<Record<AlertType, Icon>> = {
  note: Icon.ALERT_NOTE,
  tip: Icon.ALERT_TIP,
  important: Icon.ALERT_IMPORTANT,
  warning: Icon.ALERT_WARNING,
  caution: Icon.ALERT_CAUTION,
};

/**
 * Renders a blockquote opening with a GitHub alert marker as the alert box the Markdown editor draws
 * (the same classes, icon and content wrapper), so a reply's alerts read as they do in the editor. Any
 * other blockquote falls through to marked's own rendering.
 */
const githubAlert: RendererExtension = {
  name: 'blockquote',
  renderer(this: RendererThis, token: Tokens.Generic): string | false {
    const text: string = typeof token['text'] === 'string' ? token['text'] : '';
    const match: RegExpExecArray | null = ALERT_MARKER.exec(text);
    if (match === null) {
      return false;
    }
    const type: AlertType = match[1].toLowerCase() as AlertType;
    const body: string = this.parser.parse(marked.lexer(text.slice(match[0].length)));
    return (
      `<div class="github-alert github-alert-${type}">` +
      `<span class="alert-icon ${ALERT_ICONS[type].classList}" aria-hidden="true"></span>` +
      `<div class="alert-content">${body}</div></div>\n`
    );
  },
};

/**
 * Holds whether the extensions have been registered on the shared marked instance, so they are
 * installed exactly once.
 */
let extensionsRegistered: boolean = false;

/**
 * Registers the KaTeX math and GitHub alert extensions on the shared marked instance, once.
 */
function ensureExtensions(): void {
  if (!extensionsRegistered) {
    marked.use({ extensions: [blockMath, inlineMath, githubAlert] });
    extensionsRegistered = true;
  }
}

/**
 * What the transcript's sanitiser forbids beyond DOMPurify's defaults. A model's reply is rendered
 * into the same window as everything else: a `<style>` in it would restyle the whole window, not the
 * bubble (it could cover a permission card's Deny button), and a form or control invites typing that
 * a submit then sends away. Neither has a place in prose (audit S5).
 */
const TRANSCRIPT_FORBIDDEN_TAGS: readonly string[] = [
  'style',
  'form',
  'input',
  'button',
  'textarea',
  'select',
  'option',
];

/**
 * Matches the checkbox marked renders at the head of a task-list item (`- [ ]` / `- [x]`), capturing
 * whether it is ticked.
 */
const TASK_CHECKBOX: RegExp = /<input (checked="" )?disabled="" type="checkbox">/g;

/**
 * Sanitises rendered prose for the transcript. A task-list checkbox is an `<input>`, which the
 * sanitiser removes, so it is first swapped for an inert marker the styles draw as a box — otherwise
 * `- [x] done` would lose the only thing that says it is done.
 * @param html The HTML marked produced.
 * @returns Returns the HTML with scripts, handlers and the forbidden tags removed.
 */
function sanitize(html: string): string {
  const tasks: string = html.replace(
    TASK_CHECKBOX,
    (_match: string, checked: string | undefined): string =>
      checked === undefined
        ? '<span class="markdown-task" role="img" aria-label="Not done"></span>'
        : '<span class="markdown-task markdown-task--done" role="img" aria-label="Done"></span>',
  );
  return DOMPurify.sanitize(tasks, { FORBID_TAGS: [...TRANSCRIPT_FORBIDDEN_TAGS] });
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
  return cached(token.type + ' ' + token.raw, (): string => sanitize(marked.parser([token])));
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
 * Renders one contiguous run of non-code tokens carrying raw HTML to sanitised HTML, whole.
 *
 * This is the exception to the per-token path: a model can open a tag in one token and close it in a
 * later one (a `<details>` wrapper around prose, say), and sanitising those tokens separately would
 * balance the tags within each fragment instead of across the run, changing the nesting. Such a run
 * is rendered as one block, cached against the run's own source so a settled one is still free to
 * re-render.
 * @param group The tokens forming the run.
 * @returns Returns the sanitised HTML.
 */
function renderRun(group: readonly Token[]): string {
  let key: string = '';
  for (const token of group) {
    key += token.type + ' ' + token.raw;
  }
  return cached(key, (): string => sanitize(marked.parser(group as Token[])));
}

/**
 * A remembered lex: the text and the top-level tokens a full lex of it produced.
 */
interface LexEntry {
  /**
   * Gets the lexed text.
   */
  readonly text: string;

  /**
   * Gets the top-level tokens, identical to `marked.lexer(text)`.
   */
  readonly tokens: readonly Token[];

  /**
   * Gets whether the text defines link references, which a tail re-lex cannot account for.
   */
  readonly linked: boolean;
}

/**
 * The most remembered lexes. One per reply being streamed (or mirrored) at once is all that is needed;
 * a few spare cover Mission Control showing several live conversations side by side.
 */
const LEX_CACHE_ENTRIES: number = 8;

/**
 * The fewest top-level tokens a remembered lex needs before re-lexing its tail is worth it. Below this
 * the whole text is barely longer than the tail would be.
 */
const MIN_INCREMENTAL_TOKENS: number = 3;

/**
 * Matches the inline HTML tags that leave the lexer in a state carried into later blocks (`<a …>`
 * suppresses autolinks; `<pre>`/`<code>`/`<kbd>`/`<script>` stop text escaping). A fresh lexer for the
 * tail would start without that state, so a stable prefix holding one of these is lexed whole.
 */
const STATEFUL_INLINE_TAG: RegExp = /<(?:a |(?:pre|code|kbd|script)[\s>])/i;

/**
 * Holds recent lexes, most recently used last, so a streaming reply can re-lex only its growing tail.
 */
const lexCache: LexEntry[] = [];

/**
 * Lexes markdown text into its top-level tokens — exactly what `marked.lexer(text)` returns — without
 * re-lexing the whole of a streaming reply on every flush.
 *
 * A streaming reply arrives as a series of texts, each extending the one before. Every top-level token
 * of the previous text except the last two is settled: block boundaries are decided line by line, so
 * text appended past two further tokens cannot reach back across them. Only the last token is still
 * growing, and it can change meaning entirely as lines arrive (a paragraph becoming a setext heading
 * on `===`, a pipe row becoming a table once its delimiter row lands, a list turning loose), so the tail
 * is re-lexed from the start of the second-to-last token instead. The re-lex is accepted only when its
 * first token reproduces that second-to-last token exactly — same type, same source — which proves the
 * boundary before it did not move; anything else falls back to a full lex.
 *
 * Two things reach backwards across blocks in marked and also force a full lex: link reference
 * definitions (a `[label]: url` anywhere resolves `[label]` everywhere, and duplicates are dropped from
 * the token list) and the inline tags matched by {@link STATEFUL_INLINE_TAG}. Carriage returns, which
 * marked normalises before lexing (so token sources no longer index the text), do too.
 * @param text The markdown text.
 * @returns Returns the top-level tokens.
 */
export function lexMarkdown(text: string): Token[] {
  ensureExtensions();
  const incremental: Token[] | undefined = lexIncrementally(text);
  if (incremental !== undefined) {
    rememberLex({ text, tokens: incremental, linked: false });
    return incremental;
  }
  const lexed: TokensList = marked.lexer(text);
  const tokens: Token[] = [...lexed];
  rememberLex({ text, tokens, linked: definesLinks(lexed) });
  return tokens;
}

/**
 * Reports whether a lex collected any link reference definitions.
 * @param lexed The lexer's output.
 * @returns Returns `true` when at least one definition was collected.
 */
function definesLinks(lexed: TokensList): boolean {
  return Object.keys(lexed.links).length > 0;
}

/**
 * Re-lexes only the tail of a text that extends a remembered lex.
 * @param text The markdown text.
 * @returns Returns the tokens, or `undefined` when a full lex is needed.
 */
function lexIncrementally(text: string): Token[] | undefined {
  if (text.includes('\r')) {
    return undefined;
  }
  const previous: LexEntry | undefined = findExtendedLex(text);
  if (previous === undefined) {
    return undefined;
  }
  if (previous.text.length === text.length) {
    return [...previous.tokens];
  }
  if (previous.linked) {
    return undefined;
  }
  const count: number = previous.tokens.length;
  if (count < MIN_INCREMENTAL_TOKENS) {
    return undefined;
  }
  // Where the second-to-last token starts, found by summing the sources before it. The sources must
  // add up to the whole text, or a token was merged or dropped and offsets cannot be trusted (marked
  // splices a paragraph clipped at a non-math `$$` back together with a newline the source lacks, so
  // a reply holding one lexes whole from then on — correct, merely no faster than before).
  const anchor: Token = previous.tokens[count - 2];
  let start: number = 0;
  for (let index: number = 0; index < count - 2; index++) {
    start += previous.tokens[index].raw.length;
  }
  if (start + anchor.raw.length + previous.tokens[count - 1].raw.length !== previous.text.length) {
    return undefined;
  }
  if (STATEFUL_INLINE_TAG.test(text.slice(0, start))) {
    return undefined;
  }
  const tail: TokensList = marked.lexer(text.slice(start));
  if (definesLinks(tail)) {
    return undefined;
  }
  if (tail.length === 0 || tail[0].type !== anchor.type || tail[0].raw !== anchor.raw) {
    return undefined;
  }
  return [...previous.tokens.slice(0, count - 2), ...tail];
}

/**
 * Finds the remembered lex whose text is the longest prefix of the given text.
 * @param text The markdown text.
 * @returns Returns the remembered lex, or `undefined` when none is a prefix.
 */
function findExtendedLex(text: string): LexEntry | undefined {
  let best: LexEntry | undefined;
  for (const entry of lexCache) {
    if (
      (best === undefined || entry.text.length > best.text.length) &&
      text.startsWith(entry.text)
    ) {
      best = entry;
    }
  }
  return best;
}

/**
 * Remembers a lex, replacing any entry it extends (the same reply, one flush on) and evicting the
 * least-recently-used entries beyond the budget.
 * @param entry The lex to remember.
 */
function rememberLex(entry: LexEntry): void {
  for (let index: number = lexCache.length - 1; index >= 0; index--) {
    if (entry.text.startsWith(lexCache[index].text)) {
      lexCache.splice(index, 1);
    }
  }
  lexCache.push(entry);
  while (lexCache.length > LEX_CACHE_ENTRIES) {
    lexCache.shift();
  }
}

/**
 * Empties the render and lex caches. Rendering is a pure function of its input, so this only ever costs
 * time — it exists to isolate tests and to release memory on demand.
 */
export function resetMarkdownCache(): void {
  blockCache.clear();
  blockCacheChars = 0;
  lexCache.length = 0;
}

/**
 * Renders markdown text into its ordered blocks: fenced code blocks kept as raw text, everything else
 * (prose, lists, tables, block and inline math) rendered to HTML — one prose block PER TOP-LEVEL
 * TOKEN, each rendered through the shared cache (see {@link renderToken}).
 *
 * Per-token blocks are the DOM half of the streaming fix: the consumer binds one `[innerHTML]` per
 * block, so block granularity decides how much DOM a flush can rebuild. When a whole run between
 * fences was one joined block, the join's string changed on every flush of a growing reply and the
 * reply's entire prose re-parsed each time, cache hits notwithstanding; with one block per token only
 * the paragraph still being written ever changes. A run carrying raw HTML is the exception and stays
 * one whole block (see {@link renderRun}); a token rendering to nothing (blank-line separators) emits
 * no block.
 * @param text The markdown text.
 * @returns Returns the blocks in document order.
 */
export function renderMarkdownBlocks(text: string): MarkdownBlock[] {
  if (text.length === 0) {
    return [];
  }
  const tokens: Token[] = lexMarkdown(text);
  const blocks: MarkdownBlock[] = [];
  let group: Token[] = [];
  const flush: () => void = (): void => {
    if (group.length === 0) {
      return;
    }
    if (group.some((token: Token): boolean => token.type === 'html')) {
      blocks.push({ kind: 'html', html: renderRun(group) });
    } else {
      for (const token of group) {
        const html: string = renderToken(token);
        if (html.trim().length > 0) {
          blocks.push({ kind: 'html', html });
        }
      }
    }
    group = [];
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
