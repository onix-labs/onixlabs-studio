import { EMPTY_DOCUMENT, ReadDocument, ReadParagraph, ReadWord } from './read-tokenize';

/**
 * Zero (counts and comparisons).
 */
const ZERO: number = 0;

/**
 * One (increments and last-element offset).
 */
const ONE: number = 1;

/**
 * Matches a run of non-whitespace characters (a word).
 */
const WORD: RegExp = /\S+/g;

/**
 * Matches a word that ends a sentence (terminal punctuation plus closing marks).
 */
const SENTENCE_END: RegExp = /[.!?]["')\]]*$/;

/**
 * Tag names treated as readable block units (the granularity of a paragraph).
 */
const BLOCK_TAGS: ReadonlySet<string> = new Set<string>([
  'P',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'LI',
  'TD',
  'TH',
  'BLOCKQUOTE',
  'FIGCAPTION',
  'DT',
  'DD',
]);

/**
 * Tag names whose text content is never read aloud (code, controls, graphics).
 */
const SKIP_TAGS: ReadonlySet<string> = new Set<string>([
  'PRE',
  'CODE',
  'SVG',
  'TEXTAREA',
  'BUTTON',
]);

/**
 * Element class names whose subtree is never read aloud.
 */
const SKIP_CLASSES: readonly string[] = ['cm-editor', 'mermaid-block', 'html-image-block'];

/**
 * The read-along document plus the DOM ranges for each word, in word order.
 */
export interface ReadModel {
  /**
   * Gets the tokenised document (paragraphs plus words).
   */
  readonly document: ReadDocument;

  /**
   * Gets a DOM range per word, aligned to {@link ReadDocument.words} by index.
   */
  readonly ranges: readonly Range[];
}

/**
 * An empty read model.
 */
export const EMPTY_MODEL: ReadModel = { document: EMPTY_DOCUMENT, ranges: [] };

/**
 * Finds the nearest readable block ancestor of a text node, or null when the node is inside a skipped
 * region (code, graphics, and so on).
 * @param textNode The text node.
 * @param root The editor root to stop climbing at.
 * @returns Returns the nearest block element, or null.
 */
function readableBlock(textNode: Text, root: HTMLElement): HTMLElement | null {
  let element: HTMLElement | null = textNode.parentElement;
  let block: HTMLElement | null = null;
  while (element !== null && element !== root) {
    if (SKIP_TAGS.has(element.tagName)) {
      return null;
    }
    for (const className of SKIP_CLASSES) {
      if (element.classList.contains(className)) {
        return null;
      }
    }
    if (block === null && BLOCK_TAGS.has(element.tagName)) {
      block = element;
    }
    element = element.parentElement;
  }
  return block;
}

/**
 * Builds the read-along model from a rendered editor root by walking its text nodes, grouping them
 * into readable blocks, and tokenising each block into words with their DOM ranges. Deriving the words
 * from the rendered DOM (rather than the markdown source) keeps the spoken word stream and the
 * highlight ranges in lock-step — covering every node type the editor renders.
 * @param root The rendered `.ProseMirror` element, or null.
 * @returns Returns the read model.
 */
export function buildReadModel(root: HTMLElement | null): ReadModel {
  if (root === null) {
    return EMPTY_MODEL;
  }

  const walker: TreeWalker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const blocks: { element: HTMLElement; nodes: Text[] }[] = [];
  let node: Node | null = walker.nextNode();
  while (node !== null) {
    const textNode: Text = node as Text;
    if ((textNode.textContent ?? '').trim().length > ZERO) {
      const block: HTMLElement | null = readableBlock(textNode, root);
      if (block !== null) {
        const last: { element: HTMLElement; nodes: Text[] } | undefined =
          blocks[blocks.length - ONE];
        if (last?.element === block) {
          last.nodes.push(textNode);
        } else {
          blocks.push({ element: block, nodes: [textNode] });
        }
      }
    }
    node = walker.nextNode();
  }

  const paragraphs: ReadParagraph[] = [];
  const words: ReadWord[] = [];
  const ranges: Range[] = [];
  let sentenceIndex: number = ZERO;

  blocks.forEach((block: { element: HTMLElement; nodes: Text[] }, paragraphIndex: number): void => {
    if (paragraphIndex > ZERO) {
      sentenceIndex += ONE;
    }

    const startWord: number = words.length;
    let paraText: string = '';
    let endsSentence: boolean = false;

    for (const textNode of block.nodes) {
      const content: string = textNode.textContent ?? '';
      let match: RegExpExecArray | null;
      WORD.lastIndex = ZERO;
      while ((match = WORD.exec(content)) !== null) {
        if (endsSentence) {
          sentenceIndex += ONE;
          endsSentence = false;
        }
        const range: Range = root.ownerDocument.createRange();
        range.setStart(textNode, match.index);
        range.setEnd(textNode, match.index + match[0].length);
        words.push({
          text: match[0],
          globalIndex: words.length,
          paragraphIndex,
          sentenceIndex,
          charOffset: paraText.length + match.index,
        });
        ranges.push(range);
        if (SENTENCE_END.test(match[0])) {
          endsSentence = true;
        }
      }
      paraText += content;
    }

    paragraphs.push({
      index: paragraphIndex,
      text: paraText,
      startWord,
      wordCount: words.length - startWord,
    });
  });

  return { document: { paragraphs, words, totalWords: words.length }, ranges };
}
