/**
 * Milkdown plugin for collapsible sections (`<details>`/`<summary>`).
 *
 * Markdown carries collapsible sections as raw HTML:
 *
 * ```
 * <details>
 * <summary>Title</summary>
 *
 * Body content…
 *
 * </details>
 * ```
 *
 * Without this plugin those blocks render as literal markup and cannot be edited. The plugin turns
 * them into a real editor node: a collapsible block whose summary is an editable inline region,
 * whose body is ordinary editable block content, and whose header chevron expands and collapses the
 * body. Serialisation writes the same `<details>` HTML back, so documents stay portable (GitHub
 * renders them natively).
 */

import { $node, $prose, $remark } from '@milkdown/kit/utils';
import type { $Node, $Prose, $Remark } from '@milkdown/utils';
import type { MilkdownPlugin } from '@milkdown/ctx';
import type { Node as ProseMirrorNode, NodeType, DOMOutputSpec } from '@milkdown/prose/model';
import type { MarkdownNode, NodeSchema, ParserState, SerializerState } from '@milkdown/transformer';
import type { Root, RootContent, PhrasingContent } from 'mdast';
import type { EditorView } from '@milkdown/prose/view';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';

/**
 * The content hole marker in a DOMOutputSpec.
 */
const CONTENT_HOLE: 0 = 0 as const;

/**
 * Matches the opening of a details block, capturing an optional `open` flag and the summary text.
 * Tolerates attribute noise and surrounding whitespace; the summary is a single line of inline text.
 */
const DETAILS_OPEN_PATTERN: RegExp =
  /^<details(\s[^>]*)?>\s*<summary(?:\s[^>]*)?>([\s\S]*?)<\/summary>\s*/i;

/**
 * Matches a lone closing details tag.
 */
const DETAILS_CLOSE_PATTERN: RegExp = /^<\/details>\s*$/i;

/**
 * Matches a whole details block held in a single HTML node (no blank lines inside), capturing the
 * summary and the raw body text.
 */
const DETAILS_WHOLE_PATTERN: RegExp =
  /^<details(\s[^>]*)?>\s*<summary(?:\s[^>]*)?>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>\s*$/i;

/**
 * The custom mdast node the remark transform produces for the summary line.
 */
interface CollapseSummaryNode {
  type: 'collapseSummary';
  children: PhrasingContent[];
}

/**
 * The custom mdast node the remark transform produces for a whole collapsible section.
 */
interface CollapseNode {
  type: 'collapse';
  children: RootContent[];
}

/**
 * Builds the custom mdast nodes for one collapsible section.
 * @param summary The summary's plain text.
 * @param body The body's mdast children.
 * @returns Returns the collapse node.
 */
function makeCollapseNode(summary: string, body: readonly RootContent[]): CollapseNode {
  const summaryNode: CollapseSummaryNode = {
    type: 'collapseSummary',
    children: [{ type: 'text', value: summary }],
  };
  return {
    type: 'collapse',
    children: [summaryNode as unknown as RootContent, ...body],
  };
}

/**
 * Escapes the characters that would break out of an HTML text context, so an edited summary always
 * serialises to well-formed markup.
 * @param text The raw summary text.
 * @returns Returns the escaped text.
 */
function escapeHtmlText(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/**
 * Extracts the raw HTML a root child carries, when it is purely HTML. Depending on the pipeline, a
 * raw HTML block arrives either as a root-level `html` node or — after Milkdown's own remark steps —
 * as a paragraph whose children are inline `html` nodes (plus whitespace text). Anything else
 * returns null.
 * @param node The root child to read.
 * @returns Returns the combined HTML text, or null when the child is not purely HTML.
 */
function htmlTextOf(node: RootContent): string | null {
  if (node.type === 'html') {
    return node.value;
  }
  if (node.type !== 'paragraph') {
    return null;
  }
  let html: string = '';
  for (const child of node.children) {
    if (child.type === 'html') {
      html += child.value;
    } else if (child.type === 'text' && child.value.trim() === '') {
      html += child.value;
    } else {
      return null;
    }
  }
  return html.trim().length > 0 ? html : null;
}

/**
 * Groups the raw HTML pieces of every details block in a tree — the opening tag with its summary,
 * the markdown blocks between, and the closing tag — into custom `collapse` mdast nodes whose body
 * children stay ordinary, editable markdown. The HTML pieces are matched whether they arrive as
 * root-level `html` nodes or as paragraphs of inline HTML (the shape Milkdown's earlier remark
 * steps hand to plugin transforms). A details block written without blank lines arrives as a single
 * HTML piece; its body is carried as one paragraph of plain text. Exported pure so the grouping is
 * unit-testable outside an editor.
 * @param tree The mdast root to transform in place.
 * @returns Returns the same tree with details blocks grouped.
 */
export function transformCollapseTree(tree: Root): Root {
  const children: RootContent[] = tree.children;
  const rebuilt: RootContent[] = [];
  for (let index: number = 0; index < children.length; index++) {
    const child: RootContent = children[index];
    const raw: string | null = htmlTextOf(child);
    if (raw === null) {
      rebuilt.push(child);
      continue;
    }
    const value: string = raw.trim();

    // A whole details block in one HTML piece (written without blank lines).
    const whole: RegExpExecArray | null = DETAILS_WHOLE_PATTERN.exec(value);
    if (whole !== null) {
      const bodyText: string = whole[3].trim();
      const body: RootContent[] =
        bodyText.length > 0
          ? [{ type: 'paragraph', children: [{ type: 'text', value: bodyText }] }]
          : [];
      rebuilt.push(makeCollapseNode(whole[2].trim(), body) as unknown as RootContent);
      continue;
    }

    // An opening tag followed by markdown siblings and a closing tag.
    const open: RegExpExecArray | null = DETAILS_OPEN_PATTERN.exec(value);
    if (open !== null) {
      const body: RootContent[] = [];
      let closed: boolean = false;
      let scan: number = index + 1;
      for (; scan < children.length; scan++) {
        const candidate: RootContent = children[scan];
        const candidateHtml: string | null = htmlTextOf(candidate);
        if (candidateHtml !== null && DETAILS_CLOSE_PATTERN.test(candidateHtml.trim())) {
          closed = true;
          break;
        }
        body.push(candidate);
      }
      if (closed) {
        rebuilt.push(makeCollapseNode(open[2].trim(), body) as unknown as RootContent);
        index = scan;
        continue;
      }
    }

    rebuilt.push(child);
  }
  tree.children = rebuilt;
  return tree;
}

/**
 * Remark plugin wrapping {@link transformCollapseTree}.
 */
export const remarkCollapse: $Remark<'remarkCollapse', undefined> = $remark(
  'remarkCollapse',
  (): (() => (tree: Root) => Root) =>
    (): ((tree: Root) => Root) =>
    (tree: Root): Root =>
      transformCollapseTree(tree),
);

/**
 * ProseMirror node schema for the editable summary line of a collapsible section.
 */
export const collapseSummaryNode: $Node = $node(
  'collapse_summary',
  (): NodeSchema => ({
    content: 'text*',
    marks: '',
    defining: true,
    isolating: true,
    attrs: {},
    parseDOM: [{ tag: 'div[data-collapse-summary]' }],
    toDOM: (): DOMOutputSpec =>
      [
        'div',
        { 'data-collapse-summary': 'true', class: 'collapse-summary' },
        CONTENT_HOLE,
      ] as const,
    parseMarkdown: {
      match: (node: MarkdownNode): boolean => node.type === 'collapseSummary',
      runner: (state: ParserState, node: MarkdownNode, type: NodeType): void => {
        const summary: CollapseSummaryNode = node as unknown as CollapseSummaryNode;
        state.openNode(type);
        state.next(summary.children as unknown as Parameters<typeof state.next>[0]);
        state.closeNode();
      },
    },
    toMarkdown: {
      // The parent collapse node serialises the summary into the opening HTML; nothing to do here,
      // but a matcher must exist so the serializer never falls through to an unknown-node error.
      match: (node: ProseMirrorNode): boolean => node.type.name === 'collapse_summary',
      runner: (): void => undefined,
    },
  }),
);

/**
 * ProseMirror node schema for a collapsible section: the summary line followed by ordinary block
 * content, rendered with a toggle chevron that shows or hides the body.
 */
export const collapseNode: $Node = $node(
  'collapse',
  (): NodeSchema => ({
    group: 'block',
    content: 'collapse_summary block*',
    defining: true,
    isolating: true,
    attrs: {
      open: { default: true },
    },
    parseDOM: [
      {
        tag: 'div[data-collapse]',
        contentElement: 'div.collapse-inner',
        getAttrs: (dom: HTMLElement): { open: boolean } => ({
          open: dom.getAttribute('data-open') !== 'false',
        }),
      },
    ],
    toDOM: (node: ProseMirrorNode): DOMOutputSpec =>
      [
        'div',
        {
          'data-collapse': 'true',
          'data-open': String(node.attrs['open'] as boolean),
          class: 'collapse-block',
        },
        [
          'button',
          {
            class: 'collapse-toggle',
            type: 'button',
            contenteditable: 'false',
            'aria-label': 'Toggle section',
          },
        ],
        ['div', { class: 'collapse-inner' }, CONTENT_HOLE],
      ] as const,
    parseMarkdown: {
      match: (node: MarkdownNode): boolean => node.type === 'collapse',
      runner: (state: ParserState, node: MarkdownNode, type: NodeType): void => {
        const collapse: CollapseNode = node as unknown as CollapseNode;
        state.openNode(type, { open: true });
        state.next(collapse.children as unknown as Parameters<typeof state.next>[0]);
        state.closeNode();
      },
    },
    toMarkdown: {
      match: (node: ProseMirrorNode): boolean => node.type.name === 'collapse',
      runner: (state: SerializerState, node: ProseMirrorNode): void => {
        const summary: ProseMirrorNode | null = node.maybeChild(0);
        const summaryText: string =
          summary !== null && summary.type.name === 'collapse_summary' ? summary.textContent : '';
        state.addNode(
          'html',
          undefined,
          `<details>\n<summary>${escapeHtmlText(summaryText)}</summary>`,
        );
        node.content.forEach((child: ProseMirrorNode, _offset: number, index: number): void => {
          if (index > 0) {
            state.next(child);
          }
        });
        state.addNode('html', undefined, '</details>');
      },
    },
  }),
);

/**
 * ProseMirror plugin that expands or collapses a section when its header chevron is clicked. The
 * toggle flips the block's `open` attribute; the stylesheet hides the body while closed.
 */
export const collapseTogglePlugin: $Prose = $prose(
  (): Plugin =>
    new Plugin({
      key: new PluginKey('collapseToggle'),
      props: {
        handleDOMEvents: {
          click: (view: EditorView, event: MouseEvent): boolean => {
            const target: HTMLElement | null = event.target as HTMLElement | null;
            const toggle: HTMLElement | null = target?.closest('.collapse-toggle') ?? null;
            if (toggle === null) {
              return false;
            }
            const block: HTMLElement | null = toggle.closest('[data-collapse]');
            if (block === null) {
              return false;
            }
            // Resolve the position just inside the block, then step up to the collapse node itself.
            const inside: number = view.posAtDOM(block, 0);
            const resolved: ReturnType<typeof view.state.doc.resolve> =
              view.state.doc.resolve(inside);
            for (let depth: number = resolved.depth; depth > 0; depth--) {
              const candidate: ProseMirrorNode = resolved.node(depth);
              if (candidate.type.name === 'collapse') {
                const position: number = resolved.before(depth);
                view.dispatch(
                  view.state.tr.setNodeMarkup(position, undefined, {
                    ...candidate.attrs,
                    open: !(candidate.attrs['open'] as boolean),
                  }),
                );
                event.preventDefault();
                return true;
              }
            }
            return false;
          },
        },
      },
    }),
);

/**
 * All collapse plugins combined.
 */
export const collapsePlugin: MilkdownPlugin[] = [
  ...remarkCollapse,
  collapseSummaryNode,
  collapseNode,
  collapseTogglePlugin,
];
