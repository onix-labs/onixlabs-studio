/**
 * Milkdown plugin for subscript and superscript support.
 *
 * Enables subscript and superscript formatting in the WYSIWYG editor.
 *
 * Supported methods:
 * - Markdown source: <sub> and <sup> HTML tags are parsed and rendered
 * - Paste: HTML content with <sub> and <sup> tags will be rendered correctly
 * - Input rules: Type ~text~ for subscript, ^text^ for superscript
 * - Serialization: Saves as <sub> and <sup> HTML tags in markdown
 *
 * Uses handleTextInput to intercept ~text~ before GFM strikethrough can match it.
 */
import { $mark, $remark, $prose } from '@milkdown/kit/utils';
import type { $Mark, $Prose, $Remark } from '@milkdown/utils';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import type { Ctx, MilkdownPlugin } from '@milkdown/ctx';
import type { EditorView } from '@milkdown/prose/view';
import type { Transaction } from '@milkdown/prose/state';
import type { MarkType, ResolvedPos, DOMOutputSpec } from '@milkdown/prose/model';
import type { MarkSchema, MarkdownNode, ParserState, SerializerState } from '@milkdown/transformer';
import type { Mark } from '@milkdown/prose/model';
import type { Node as ProseMirrorNode } from '@milkdown/prose/model';
import type { Root, RootContent, PhrasingContent, Html, Paragraph, Parent } from 'mdast';
import { visit } from 'unist-util-visit';

/**
 * Number of leading characters preceding an opening delimiter to skip when
 * computing a match offset.
 */
const DELIMITER_OFFSET: number = 1;

/**
 * Index offset used to advance past a closing tag during transformation.
 */
const SKIP_CLOSING_TAG: number = 1;

/**
 * Offset to the node immediately following the current index.
 */
const NEXT_NODE_OFFSET: number = 1;

/**
 * Empty length used to detect paragraphs or matches with no content.
 */
const EMPTY_LENGTH: number = 0;

/**
 * Number of characters of preceding text to inspect for delimiter matching.
 */
const TEXT_LOOKBEHIND: number = 50;

/**
 * ProseMirror DOM output hole marker indicating where child content is rendered.
 */
const DOM_CONTENT_HOLE: number = 0;

/**
 * Custom mdast node types for subscript and superscript.
 */
interface SubSupNode {
  type: 'subscript' | 'superscript';
  children: PhrasingContent[];
}

/**
 * Transforms a sequence of nodes containing inline HTML tags into custom nodes.
 * Handles patterns like: [text, html(<sub>), text, html(</sub>), text]
 *
 * @param children The sequence of mdast nodes to scan and transform.
 * @param openTag Regular expression matching the opening HTML tag.
 * @param closeTag Regular expression matching the closing HTML tag.
 * @param nodeType The custom node type to create for matched sequences.
 * @returns A new array of nodes with matching tag sequences replaced by custom nodes.
 */
function transformInlineHtml(
  children: RootContent[],
  openTag: RegExp,
  closeTag: RegExp,
  nodeType: 'subscript' | 'superscript',
): RootContent[] {
  const result: RootContent[] = [];
  let i: number = 0;

  while (i < children.length) {
    const node: RootContent = children[i];

    // Check for opening tag in html node
    if (node.type === 'html' && openTag.test(node.value)) {
      // Look for content and closing tag
      let content: string = '';
      let j: number = i + NEXT_NODE_OFFSET;
      let foundClose: boolean = false;

      // Check if opening tag contains content too (e.g., <sub>text</sub>)
      const fullMatch: RegExpMatchArray | null = new RegExp(
        `${openTag.source}(.+?)${closeTag.source}`,
        'i',
      ).exec(node.value);
      if (fullMatch) {
        const newNode: SubSupNode = {
          type: nodeType,
          children: [{ type: 'text', value: fullMatch[1] }],
        };
        result.push(newNode as unknown as RootContent);
        i++;
        continue;
      }

      // Collect content between tags
      while (j < children.length) {
        const nextNode: RootContent = children[j];
        if (nextNode.type === 'html' && closeTag.test(nextNode.value)) {
          foundClose = true;
          break;
        } else if (nextNode.type === 'text') {
          content += nextNode.value;
        }
        j++;
      }

      if (foundClose && content) {
        const newNode: SubSupNode = {
          type: nodeType,
          children: [{ type: 'text', value: content }],
        };
        result.push(newNode as unknown as RootContent);
        i = j + SKIP_CLOSING_TAG; // Skip past closing tag
        continue;
      }
    }

    result.push(node);
    i++;
  }

  return result;
}

/**
 * Remark plugin that transforms inline <sub> and <sup> HTML tags
 * into custom mdast nodes that can be parsed by the mark schemas.
 */
export const remarkSubSup: $Remark<'remarkSubSup', undefined> = $remark(
  'remarkSubSup',
  (): (() => (tree: Root) => Root) =>
    (): ((tree: Root) => Root) =>
    (tree: Root): Root => {
      // First pass: handle complete <sub>...</sub> and <sup>...</sup> in single html nodes
      visit(
        tree,
        'html',
        (node: Html, index: number | undefined, parent: Parent | undefined): void => {
          if (index === undefined || !parent) return;

          const html: string = node.value;

          // Check for subscript: <sub>...</sub>
          const subMatch: RegExpMatchArray | null = /^<sub>(.+?)<\/sub>$/i.exec(html);
          if (subMatch) {
            const content: string = subMatch[1];
            const newNode: SubSupNode = {
              type: 'subscript',
              children: [{ type: 'text', value: content }],
            };
            parent.children[index] = newNode as unknown as RootContent;
            return;
          }

          // Check for superscript: <sup>...</sup>
          const supMatch: RegExpMatchArray | null = /^<sup>(.+?)<\/sup>$/i.exec(html);
          if (supMatch) {
            const content: string = supMatch[1];
            const newNode: SubSupNode = {
              type: 'superscript',
              children: [{ type: 'text', value: content }],
            };
            parent.children[index] = newNode as unknown as RootContent;
            return;
          }
        },
      );

      // Second pass: handle split inline HTML (separate open/close tags)
      visit(tree, 'paragraph', (node: Paragraph): void => {
        if (!node.children || node.children.length === EMPTY_LENGTH) return;

        // Transform subscript sequences
        let transformed: RootContent[] = transformInlineHtml(
          node.children,
          /^<sub>$/i,
          /^<\/sub>$/i,
          'subscript',
        );

        // Transform superscript sequences
        transformed = transformInlineHtml(transformed, /^<sup>$/i, /^<\/sup>$/i, 'superscript');

        node.children = transformed as PhrasingContent[];
      });

      return tree;
    },
);

/**
 * Subscript mark schema.
 * Handles <sub> tags for pasting, markdown parsing, and serialization.
 */
export const subscriptMark: $Mark = $mark('subscript', (): MarkSchema => ({
  parseDOM: [{ tag: 'sub' }],
  toDOM: (): DOMOutputSpec => ['sub', DOM_CONTENT_HOLE],
  parseMarkdown: {
    match: (node: MarkdownNode): boolean => node.type === 'subscript',
    runner: (state: ParserState, node: MarkdownNode, markType: MarkType): void => {
      state.openMark(markType);
      const children: PhrasingContent[] = (node as unknown as SubSupNode).children;
      if (children && children.length > EMPTY_LENGTH) {
        const textChild: PhrasingContent = children[0];
        if (textChild.type === 'text') {
          state.addText(textChild.value);
        }
      }
      state.closeMark(markType);
    },
  },
  toMarkdown: {
    match: (mark: Mark): boolean => mark.type.name === 'subscript',
    runner: (state: SerializerState, mark: Mark, node: ProseMirrorNode): void => {
      state.withMark(mark, 'text', undefined, {
        value: `<sub>${node.text ?? ''}</sub>`,
      });
    },
  },
}));

/**
 * Superscript mark schema.
 * Handles <sup> tags for pasting, markdown parsing, and serialization.
 */
export const superscriptMark: $Mark = $mark('superscript', (): MarkSchema => ({
  parseDOM: [{ tag: 'sup' }],
  toDOM: (): DOMOutputSpec => ['sup', DOM_CONTENT_HOLE],
  parseMarkdown: {
    match: (node: MarkdownNode): boolean => node.type === 'superscript',
    runner: (state: ParserState, node: MarkdownNode, markType: MarkType): void => {
      state.openMark(markType);
      const children: PhrasingContent[] = (node as unknown as SubSupNode).children;
      if (children && children.length > EMPTY_LENGTH) {
        const textChild: PhrasingContent = children[0];
        if (textChild.type === 'text') {
          state.addText(textChild.value);
        }
      }
      state.closeMark(markType);
    },
  },
  toMarkdown: {
    match: (mark: Mark): boolean => mark.type.name === 'superscript',
    runner: (state: SerializerState, mark: Mark, node: ProseMirrorNode): void => {
      state.withMark(mark, 'text', undefined, {
        value: `<sup>${node.text ?? ''}</sup>`,
      });
    },
  },
}));

/**
 * Plugin key for the subscript/superscript text input handler.
 */
const subSupPluginKey: PluginKey = new PluginKey('subscriptSuperscriptInput');

/**
 * ProseMirror plugin that handles ~text~ for subscript and ^text^ for superscript.
 * Uses handleTextInput which runs BEFORE input rules, allowing us to intercept
 * single-tilde patterns before GFM strikethrough (which matches ~{1,2}) can claim them.
 */
export const subscriptSuperscriptInputPlugin: $Prose = $prose((ctx: Ctx): Plugin => {
  const subMarkType: MarkType = subscriptMark.type(ctx);
  const supMarkType: MarkType = superscriptMark.type(ctx);

  return new Plugin({
    key: subSupPluginKey,
    props: {
      handleTextInput(view: EditorView, from: number, to: number, text: string): boolean {
        // Only check when typing a closing delimiter
        if (text !== '~' && text !== '^') {
          return false;
        }

        const state: EditorView['state'] = view.state;
        const $from: ResolvedPos = state.doc.resolve(from);
        const textBefore: string = $from.parent.textBetween(
          Math.max(EMPTY_LENGTH, $from.parentOffset - TEXT_LOOKBEHIND),
          $from.parentOffset,
          undefined,
          '\ufffc',
        );

        if (text === '~') {
          // Look for ~text pattern (single tilde, not double)
          // Match: not preceded by ~, then ~, then content without ~
          const match: RegExpMatchArray | null = /(?:^|[^~])~([^~]+)$/.exec(textBefore);
          if (match) {
            const content: string = match[1];
            const matchStart: number = textBefore.length - content.length - DELIMITER_OFFSET;
            const absoluteStart: number = from - (textBefore.length - matchStart);

            // Check character before the opening ~ to ensure it's not another ~
            const charBeforeMatch: string = textBefore[matchStart - DELIMITER_OFFSET];
            if (charBeforeMatch === '~') {
              // This is ~~text, let strikethrough handle it
              return false;
            }

            const tr: Transaction = state.tr
              .delete(absoluteStart, from)
              .insertText(content, absoluteStart)
              .addMark(absoluteStart, absoluteStart + content.length, subMarkType.create());

            view.dispatch(tr);
            return true;
          }
        }

        if (text === '^') {
          // Look for ^text pattern
          const match: RegExpMatchArray | null = /(?:^|[^^])\^([^^]+)$/.exec(textBefore);
          if (match) {
            const content: string = match[1];
            const matchStart: number = textBefore.length - content.length - DELIMITER_OFFSET;
            const absoluteStart: number = from - (textBefore.length - matchStart);

            const tr: Transaction = state.tr
              .delete(absoluteStart, from)
              .insertText(content, absoluteStart)
              .addMark(absoluteStart, absoluteStart + content.length, supMarkType.create());

            view.dispatch(tr);
            return true;
          }
        }

        return false;
      },
    },
  });
});

/**
 * Combined plugin array for subscript and superscript support.
 */
export const subscriptSuperscriptPlugin: MilkdownPlugin[] = [
  ...remarkSubSup,
  subscriptMark,
  superscriptMark,
  subscriptSuperscriptInputPlugin,
];
