/**
 * Milkdown plugin for rendering HTML image blocks with click-to-edit behavior.
 *
 * Supports:
 * - `<img>` tags with attributes (src, alt, width, height, etc.)
 * - `<p align="...">` wrappers for image alignment
 *
 * When clicked, the rendered HTML switches to editable raw HTML.
 * When unfocused, the raw HTML is re-rendered.
 */

import { $node, $remark } from '@milkdown/kit/utils';
import type { $Node, $Remark } from '@milkdown/utils';
import type { MilkdownPlugin } from '@milkdown/ctx';
import type { Node as ProseMirrorNode, NodeType } from '@milkdown/prose/model';
import type { MarkdownNode, NodeSchema, ParserState, SerializerState } from '@milkdown/transformer';
import type { Root, RootContent, Paragraph, Html, Parent } from 'mdast';
import { visit } from 'unist-util-visit';

/**
 * Number of children that indicates an empty paragraph node.
 */
const EMPTY_CHILDREN: number = 0;

/**
 * Regex to match HTML image patterns we want to handle.
 * Matches: <img ...> or <p align="...">...</p>
 */
const HTML_IMAGE_PATTERN: RegExp = /^<(?:img\s|p\s+align=)/i;

/**
 * Custom mdast node type for HTML image blocks.
 */
interface HtmlImageNode {
  type: 'htmlImageBlock';
  value: string;
}

/**
 * Remark plugin that transforms HTML blocks containing images
 * into custom mdast nodes that can be parsed by the node schema.
 */
export const remarkHtmlImage: $Remark<'remarkHtmlImage', undefined> = $remark(
  'remarkHtmlImage',
  (): (() => (tree: Root) => Root) =>
    (): ((tree: Root) => Root) =>
    (tree: Root): Root => {
      // First pass: find paragraphs that contain only HTML image content
      // and transform them to our custom block node
      visit(
        tree,
        'paragraph',
        (node: Paragraph, index: number | undefined, parent: Parent | undefined): void => {
          if (index === undefined || !parent) return;
          if (parent.type !== 'root') return;

          // Check if paragraph contains only HTML that matches our pattern
          // This handles cases where remark treats <img> as inline HTML inside a paragraph
          const children: Paragraph['children'] = node.children;
          if (!children || children.length === EMPTY_CHILDREN) return;

          // Collect all HTML content from the paragraph
          let htmlContent: string = '';
          let hasOnlyHtml: boolean = true;

          for (const child of children) {
            if (child.type === 'html') {
              htmlContent += child.value;
            } else if (child.type === 'text' && child.value.trim() === '') {
              // Allow whitespace-only text nodes
              htmlContent += child.value;
            } else {
              hasOnlyHtml = false;
              break;
            }
          }

          if (!hasOnlyHtml || !htmlContent.trim()) return;

          // Check if the collected HTML matches our pattern
          if (HTML_IMAGE_PATTERN.test(htmlContent.trim())) {
            const newNode: HtmlImageNode = {
              type: 'htmlImageBlock',
              value: htmlContent,
            };
            parent.children[index] = newNode as unknown as RootContent;
          }
        },
      );

      // Second pass: handle root-level HTML nodes directly
      visit(
        tree,
        'html',
        (node: Html, index: number | undefined, parent: Parent | undefined): void => {
          if (index === undefined || !parent) return;
          if (parent.type !== 'root') return;

          const html: string = node.value.trim();

          // Check if this HTML block contains an image pattern
          if (HTML_IMAGE_PATTERN.test(html)) {
            const newNode: HtmlImageNode = {
              type: 'htmlImageBlock',
              value: node.value,
            };
            parent.children[index] = newNode as unknown as RootContent;
          }
        },
      );

      return tree;
    },
);

/**
 * ProseMirror node schema for HTML image blocks.
 */
export const htmlImageNode: $Node = $node('html_image', (): NodeSchema => ({
  group: 'block',
  content: '',
  marks: '',
  defining: true,
  isolating: true,
  atom: true,
  attrs: {
    value: { default: '' },
  },
  parseDOM: [
    {
      tag: 'div[data-html-image]',
      getAttrs: (dom: HTMLElement): { value: string } => ({
        value: dom.getAttribute('data-value') ?? '',
      }),
    },
  ],
  toDOM: (node: ProseMirrorNode): HTMLElement => {
    const value: string = node.attrs['value'] as string;

    // Create wrapper element
    const wrapper: HTMLDivElement = document.createElement('div');
    wrapper.setAttribute('data-html-image', 'true');
    wrapper.setAttribute('data-value', value);
    wrapper.className = 'html-image-block rendered';

    // Create a container for the rendered content
    const content: HTMLDivElement = document.createElement('div');
    content.className = 'html-image-content';
    content.innerHTML = value;
    wrapper.appendChild(content);

    return wrapper;
  },
  parseMarkdown: {
    match: (node: MarkdownNode): boolean => node.type === 'htmlImageBlock',
    runner: (state: ParserState, node: MarkdownNode, type: NodeType): void => {
      const htmlNode: HtmlImageNode = node as unknown as HtmlImageNode;
      state.addNode(type, { value: htmlNode.value });
    },
  },
  toMarkdown: {
    match: (node: ProseMirrorNode): boolean => node.type.name === 'html_image',
    runner: (state: SerializerState, node: ProseMirrorNode): void => {
      state.addNode('html', undefined, node.attrs['value'] as string);
    },
  },
}));

/**
 * All HTML image plugins combined.
 */
export const htmlImagePlugin: MilkdownPlugin[] = [...remarkHtmlImage, htmlImageNode];
