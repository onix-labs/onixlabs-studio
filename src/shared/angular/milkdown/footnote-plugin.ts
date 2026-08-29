/**
 * Milkdown plugin for customizing footnote rendering.
 *
 * Features:
 * - Collects all footnote definitions and moves them to the end of the document
 * - Wraps footnotes in a section with an HR separator
 * - Styles footnote labels with muted color
 */

import { $node, $remark } from '@milkdown/kit/utils';
import type { $Node, $Remark } from '@milkdown/utils';
import type { MilkdownPlugin } from '@milkdown/ctx';
import type { Node as ProseMirrorNode, NodeType, DOMOutputSpec } from '@milkdown/prose/model';
import type { NodeSchema, ParserState, SerializerState, MarkdownNode } from '@milkdown/transformer';
import type { Root, RootContent } from 'mdast';

/**
 * Number of footnote definitions required before a footnotes section is created.
 */
const NO_FOOTNOTES: number = 0;

/**
 * ProseMirror DOM-spec hole index marking where child content is rendered.
 */
const CONTENT_HOLE: number = 0;

/**
 * Interface for footnote definition nodes in mdast.
 */
interface FootnoteDefinition {
  type: 'footnoteDefinition';
  identifier: string;
  label?: string;
  children: RootContent[];
}

/**
 * Custom mdast node type for the footnotes section wrapper.
 */
interface FootnotesSection {
  type: 'footnotesSection';
  children: FootnoteDefinition[];
}

/**
 * Remark plugin that collects all footnote definitions and moves them
 * to the end of the document wrapped in a footnotesSection node.
 */
export const remarkFootnotesCollector: $Remark<'remarkFootnotesCollector', undefined> = $remark(
  'remarkFootnotesCollector',
  (): (() => (tree: Root) => Root) =>
    (): ((tree: Root) => Root) =>
    (tree: Root): Root => {
      const footnotes: FootnoteDefinition[] = [];
      const otherChildren: RootContent[] = [];

      // Separate footnote definitions from other content
      for (const child of tree.children) {
        if (child.type === 'footnoteDefinition') {
          footnotes.push(child as FootnoteDefinition);
        } else {
          otherChildren.push(child);
        }
      }

      // If there are no footnotes, return the tree unchanged
      if (footnotes.length === NO_FOOTNOTES) {
        return tree;
      }

      // Create the footnotes section wrapper
      const footnotesSection: FootnotesSection = {
        type: 'footnotesSection',
        children: footnotes,
      };

      // Rebuild the tree with footnotes at the end
      tree.children = [...otherChildren, footnotesSection as unknown as RootContent];

      return tree;
    },
);

/**
 * ProseMirror node schema for the footnotes section wrapper.
 * This renders an HR followed by the footnote definitions.
 */
export const footnotesSectionNode: $Node = $node('footnotes_section', (): NodeSchema => ({
  group: 'block',
  content: 'footnote_definition+',
  defining: true,
  isolating: true,
  attrs: {},
  parseDOM: [
    {
      tag: 'section.footnotes-section',
    },
  ],
  toDOM: (): DOMOutputSpec => {
    return [
      'section',
      { class: 'footnotes-section' },
      ['hr', { class: 'footnotes-separator' }],
      ['div', { class: 'footnotes-content' }, CONTENT_HOLE],
    ] as const;
  },
  parseMarkdown: {
    match: (node: MarkdownNode): boolean => node.type === 'footnotesSection',
    runner: (state: ParserState, node: MarkdownNode, type: NodeType): void => {
      const section: FootnotesSection = node as unknown as FootnotesSection;
      state.openNode(type);
      // Process each footnote definition - cast children to expected type
      state.next(section.children as unknown as Parameters<typeof state.next>[0]);
      state.closeNode();
    },
  },
  toMarkdown: {
    match: (node: ProseMirrorNode): boolean => node.type.name === 'footnotes_section',
    runner: (state: SerializerState, node: ProseMirrorNode): void => {
      // Serialize each child footnote definition directly
      // The footnote_definition nodes handle their own serialization
      node.content.forEach((child: ProseMirrorNode): void => {
        state.next(child);
      });
    },
  },
}));

/**
 * All footnote plugins combined.
 */
export const footnotePlugin: MilkdownPlugin[] = [...remarkFootnotesCollector, footnotesSectionNode];
