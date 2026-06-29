/**
 * Milkdown plugin for GitHub-style alerts.
 *
 * Supports:
 * - `> [!NOTE]` - Blue information alert
 * - `> [!TIP]` - Green tip/suggestion alert
 * - `> [!IMPORTANT]` - Purple important information alert
 * - `> [!WARNING]` - Yellow warning alert
 * - `> [!CAUTION]` - Red danger/caution alert
 *
 * Renders blockquotes with these markers as styled alert boxes with icons.
 */

import { $node, $remark, $command, $prose } from '@milkdown/kit/utils';
import type { $Node, $Remark, $Command, $Prose } from '@milkdown/utils';
import type { MilkdownPlugin } from '@milkdown/ctx';
import type { Cmd } from '@milkdown/core';
import {
  type Node as ProseMirrorNode,
  type NodeType,
  type DOMOutputSpec,
  Fragment,
} from '@milkdown/prose/model';
import type { MarkdownNode, ParserState, SerializerState, NodeSchema } from '@milkdown/transformer';
import type { Root, RootContent, Blockquote, Paragraph, Text } from 'mdast';
import type { Parent } from 'unist';
import { visit } from 'unist-util-visit';
import { Icon } from '@shared/angular/icons/icon';
import {
  type Command,
  type EditorState,
  type Transaction,
  TextSelection,
} from '@milkdown/prose/state';
import { findWrapping } from '@milkdown/prose/transform';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';

/**
 * Index of the first array element (used when checking emptiness).
 */
const FIRST_INDEX: number = 0;

/**
 * Offset that skips the first child of a collection.
 */
const SKIP_FIRST: number = 1;

/**
 * Start index for slicing past the `[!` prefix of an alert marker.
 */
const MARKER_TYPE_START: number = 2;

/**
 * End offset for slicing before the `]` suffix of an alert marker.
 */
const MARKER_TYPE_END: number = -1;

/**
 * Offset from a block's start position to the text inside its first paragraph.
 */
const PARAGRAPH_TEXT_OFFSET: number = 2;

/**
 * Default text length used when a paragraph has no resolvable content.
 */
const EMPTY_TEXT_LENGTH: number = 0;

/**
 * Valid alert types that can be used in GitHub-style alerts.
 */
type AlertType = 'note' | 'tip' | 'important' | 'warning' | 'caution';

/**
 * Pattern to match alert type markers: [!NOTE], [!TIP], etc.
 */
const ALERT_PATTERN: RegExp = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]$/i;

/**
 * Icon for each alert type.
 */
const ALERT_ICONS: Record<AlertType, Icon> = {
  note: Icon.ALERT_NOTE,
  tip: Icon.ALERT_TIP,
  important: Icon.ALERT_IMPORTANT,
  warning: Icon.ALERT_WARNING,
  caution: Icon.ALERT_CAUTION,
};

/**
 * Custom mdast node type for alert blocks.
 */
interface AlertBlockNode {
  type: 'alertBlock';
  alertType: AlertType;
  children: RootContent[];
}

/**
 * Checks if an mdast node is a paragraph.
 *
 * @param node The mdast node to test.
 * @returns True when the node is a paragraph.
 */
function isParagraph(node: RootContent): node is Paragraph {
  return node.type === 'paragraph';
}

/**
 * Checks if an mdast node is a text node.
 *
 * @param node The mdast node to test.
 * @param node.type The discriminant type string of the node.
 * @returns True when the node is a text node.
 */
function isText(node: { type: string }): node is Text {
  return node.type === 'text';
}

/**
 * Remark plugin that transforms blockquotes starting with [!TYPE]
 * into custom alertBlock mdast nodes.
 */
export const remarkGithubAlert: $Remark<'remarkGithubAlert', undefined> = $remark(
  'remarkGithubAlert',
  (): (() => (tree: Root) => Root) =>
    (): ((tree: Root) => Root) =>
    (tree: Root): Root => {
      visit(
        tree,
        'blockquote',
        (node: Blockquote, index: number | undefined, parent: Parent | undefined): void => {
          if (index === undefined || !parent) return;

          const children: RootContent[] = node.children;
          if (!children || children.length === FIRST_INDEX) return;

          // Check if first child is a paragraph
          const firstChild: RootContent = children[0];
          if (!isParagraph(firstChild)) return;

          const paragraphChildren: Paragraph['children'] = firstChild.children;
          if (!paragraphChildren || paragraphChildren.length === FIRST_INDEX) return;

          // Check if first element in paragraph is text starting with alert marker
          const firstTextNode: Paragraph['children'][number] = paragraphChildren[0];
          if (!isText(firstTextNode)) return;

          const text: string = firstTextNode.value.trim();

          // Check if the text starts with an alert marker
          // It could be just the marker, or marker followed by content
          const lines: string[] = text.split('\n');
          const firstLine: string = lines[0].trim();
          const match: RegExpMatchArray | null = ALERT_PATTERN.exec(firstLine);

          if (!match) return;

          const alertType: AlertType = match[1].toLowerCase() as AlertType;

          // Build new content without the alert marker
          const newContent: RootContent[] = [];

          // Handle the first paragraph
          // If there's content after the marker on the same line, or on subsequent lines
          const remainingText: string = text.slice(match[0].length).trim();

          if (remainingText) {
            // There's content after the marker
            const newParagraph: Paragraph = {
              type: 'paragraph',
              children: [
                { type: 'text', value: remainingText },
                ...paragraphChildren.slice(SKIP_FIRST),
              ],
            };
            newContent.push(newParagraph);
          } else if (paragraphChildren.length > SKIP_FIRST) {
            // The marker was alone but there's more in the paragraph
            const newParagraph: Paragraph = {
              type: 'paragraph',
              children: [...paragraphChildren.slice(SKIP_FIRST)],
            };
            newContent.push(newParagraph);
          }

          // Add remaining children from the original blockquote
          newContent.push(...children.slice(SKIP_FIRST));

          // Create the alert block node
          const alertNode: AlertBlockNode = {
            type: 'alertBlock',
            alertType,
            children: newContent,
          };

          // Replace the blockquote with our alert node
          (parent.children as RootContent[])[index] = alertNode as unknown as RootContent;
        },
      );

      return tree;
    },
);

/**
 * ProseMirror node schema for alert blocks.
 */
export const alertBlockNode: $Node = $node(
  'alert_block',
  (): NodeSchema => ({
    group: 'block',
    content: 'block+',
    defining: true,
    attrs: {
      alertType: { default: 'note' },
    },
    parseDOM: [
      {
        tag: 'div.github-alert',
        getAttrs: (dom: HTMLElement): { alertType: string } => ({
          alertType: dom.getAttribute('data-alert-type') ?? 'note',
        }),
      },
    ],
    toDOM: (node: ProseMirrorNode): DOMOutputSpec => {
      const alertType: AlertType = (node.attrs['alertType'] as AlertType) || 'note';
      const iconClass: string = (ALERT_ICONS[alertType] || ALERT_ICONS.note).classList;

      // Create the alert container
      const wrapper: HTMLDivElement = document.createElement('div');
      wrapper.className = `github-alert github-alert-${alertType}`;
      wrapper.setAttribute('data-alert-type', alertType);

      // Create the icon
      const icon: HTMLSpanElement = document.createElement('span');
      icon.className = `alert-icon ${iconClass}`;
      icon.setAttribute('aria-hidden', 'true');
      wrapper.appendChild(icon);

      // Create the content wrapper (ProseMirror will fill this with content)
      const contentWrapper: HTMLDivElement = document.createElement('div');
      contentWrapper.className = 'alert-content';
      wrapper.appendChild(contentWrapper);

      // Return DOM structure with contentDOM for ProseMirror to insert child content
      return { dom: wrapper, contentDOM: contentWrapper };
    },
    parseMarkdown: {
      match: (node: MarkdownNode): boolean => node.type === 'alertBlock',
      runner: (state: ParserState, node: MarkdownNode, type: NodeType): void => {
        const alertNode: AlertBlockNode = node as unknown as AlertBlockNode;
        state.openNode(type, { alertType: alertNode.alertType });

        // Process children
        if (alertNode.children && alertNode.children.length > FIRST_INDEX) {
          for (const child of alertNode.children) {
            // Cast to MarkdownNode since we know these are valid mdast nodes
            state.next(child as unknown as MarkdownNode);
          }
        } else {
          // If no content, add an empty paragraph
          state.addNode(state.schema.nodes['paragraph']);
        }

        state.closeNode();
      },
    },
    toMarkdown: {
      match: (node: ProseMirrorNode): boolean => node.type.name === 'alert_block',
      runner: (state: SerializerState, node: ProseMirrorNode): void => {
        const alertType: string = (node.attrs['alertType'] as string).toUpperCase();

        // Open a blockquote
        state.openNode('blockquote');

        // Add the alert marker as the first paragraph
        state.openNode('paragraph');
        state.addNode('text', undefined, `[!${alertType}]`);
        state.closeNode();

        // Add the content
        node.content.forEach((child: ProseMirrorNode): void => {
          state.next(child);
        });

        state.closeNode();
      },
    },
  }),
);

/**
 * Creates a command that wraps the current block in an alert of the specified type.
 *
 * @param alertType The type of alert to create.
 * @returns A ProseMirror command.
 */
function createWrapInAlertCommand(alertType: AlertType): Command {
  return (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
    const { selection, schema }: EditorState = state;
    const { $from, $to }: typeof selection = selection;

    // Get the alert_block node type
    const alertBlockType: NodeType | undefined = schema.nodes['alert_block'];
    if (!alertBlockType) return false;

    // Find the range of blocks to wrap
    const range: ReturnType<typeof $from.blockRange> = $from.blockRange($to);
    if (!range) return false;

    // Check if we can wrap using ProseMirror's findWrapping
    const wrapping: ReturnType<typeof findWrapping> = findWrapping(range, alertBlockType, {
      alertType,
    });
    if (!wrapping) return false;

    if (dispatch) {
      dispatch(state.tr.wrap(range, wrapping).scrollIntoView());
    }

    return true;
  };
}

/**
 * Command to wrap current block in a NOTE alert.
 */
export const wrapInNoteAlertCommand: $Command<undefined> = $command(
  'wrapInNoteAlert',
  (): Cmd<undefined> => (): Command => {
    return createWrapInAlertCommand('note');
  },
);

/**
 * Command to wrap current block in a TIP alert.
 */
export const wrapInTipAlertCommand: $Command<undefined> = $command(
  'wrapInTipAlert',
  (): Cmd<undefined> => (): Command => {
    return createWrapInAlertCommand('tip');
  },
);

/**
 * Command to wrap current block in an IMPORTANT alert.
 */
export const wrapInImportantAlertCommand: $Command<undefined> = $command(
  'wrapInImportantAlert',
  (): Cmd<undefined> => (): Command => {
    return createWrapInAlertCommand('important');
  },
);

/**
 * Command to wrap current block in a WARNING alert.
 */
export const wrapInWarningAlertCommand: $Command<undefined> = $command(
  'wrapInWarningAlert',
  (): Cmd<undefined> => (): Command => {
    return createWrapInAlertCommand('warning');
  },
);

/**
 * Command to wrap current block in a CAUTION alert.
 */
export const wrapInCautionAlertCommand: $Command<undefined> = $command(
  'wrapInCautionAlert',
  (): Cmd<undefined> => (): Command => {
    return createWrapInAlertCommand('caution');
  },
);

/**
 * Pattern to match alert markers at the start of text, possibly with content after.
 */
const ALERT_TEXT_PATTERN: RegExp = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i;

/**
 * Plugin key for the blockquote-to-alert converter.
 */
const blockquoteToAlertKey: PluginKey = new PluginKey('blockquoteToAlert');

/**
 * Result of locating a blockquote that should become an alert.
 */
interface BlockquoteMatch {
  pos: number;
  node: ProseMirrorNode;
  alertType: AlertType;
  remainingText: string;
}

/**
 * Finds a blockquote that should be converted to an alert.
 * Returns the match info or null if no conversion is needed.
 *
 * @param doc The document to search.
 * @param blockquoteType The blockquote node type to match against.
 * @param blockquoteType.name The schema name of the blockquote node type.
 * @param paragraphType The paragraph node type to match against.
 * @param paragraphType.name The schema name of the paragraph node type.
 * @returns The blockquote match details, or null when no conversion is needed.
 */
function findBlockquoteToConvert(
  doc: ProseMirrorNode,
  blockquoteType: { name: string },
  paragraphType: { name: string },
): BlockquoteMatch | null {
  let result: BlockquoteMatch | null = null;

  doc.descendants((node: ProseMirrorNode, pos: number): boolean => {
    if (result) {
      return false; // Already found one, stop traversing
    }

    if (node.type.name !== blockquoteType.name) {
      return true; // Continue traversing
    }

    // Check if the blockquote's first child is a paragraph
    const firstChild: ProseMirrorNode | null = node.firstChild;
    if (firstChild?.type.name !== paragraphType.name) {
      return true;
    }

    // Get the text content of the first paragraph
    const textContent: string = firstChild.textContent;
    const match: RegExpMatchArray | null = ALERT_TEXT_PATTERN.exec(textContent);

    if (!match) {
      return true;
    }

    const alertType: AlertType = match[0]
      .slice(MARKER_TYPE_START, MARKER_TYPE_END)
      .toLowerCase() as AlertType;
    const remainingText: string = textContent.slice(match[0].length);

    result = { pos, node, alertType, remainingText };
    return false; // Stop traversing
  });

  return result;
}

/**
 * ProseMirror plugin that converts blockquotes starting with [!TYPE] to alerts.
 * This runs on every transaction to detect when the user types an alert marker.
 */
export const blockquoteToAlertPlugin: $Prose = $prose((): Plugin => {
  return new Plugin({
    key: blockquoteToAlertKey,
    appendTransaction(
      transactions: readonly Transaction[],
      oldState: EditorState,
      newState: EditorState,
    ): Transaction | null {
      // Only process if there were actual changes
      if (!transactions.some((tr: Transaction): boolean => tr.docChanged)) {
        return null;
      }

      const { schema }: EditorState = newState;
      const alertBlockType: NodeType | undefined = schema.nodes['alert_block'];
      const blockquoteType: NodeType | undefined = schema.nodes['blockquote'];
      const paragraphType: NodeType | undefined = schema.nodes['paragraph'];

      if (!alertBlockType || !blockquoteType) {
        return null;
      }

      // Find the first blockquote that needs conversion
      const match: BlockquoteMatch | null = findBlockquoteToConvert(
        newState.doc,
        blockquoteType,
        paragraphType,
      );

      if (!match) {
        return null;
      }

      const { pos, node, alertType, remainingText }: BlockquoteMatch = match;

      // Create the new content for the alert
      const newContent: ProseMirrorNode[] = [];

      if (remainingText.trim()) {
        // There's text after the marker - create a paragraph with it
        const newParagraph: ProseMirrorNode = paragraphType.create(
          null,
          schema.text(remainingText),
        );
        newContent.push(newParagraph);
      }

      // Add any remaining children from the blockquote (after the first paragraph)
      for (let i: number = SKIP_FIRST; i < node.childCount; i++) {
        newContent.push(node.child(i));
      }

      // If no content, add an empty paragraph
      if (newContent.length === FIRST_INDEX) {
        newContent.push(paragraphType.create());
      }

      // Create the alert block
      const alertNode: ProseMirrorNode = alertBlockType.create(
        { alertType },
        Fragment.from(newContent),
      );

      // Create transaction, replace blockquote with alert, and set cursor position
      const tr: Transaction = newState.tr.replaceWith(pos, pos + node.nodeSize, alertNode);

      // Calculate cursor position inside the new alert
      // Position should be at the end of the first paragraph's text content
      // Alert structure: alert_block > paragraph > text
      // pos = start of alert_block
      // pos + 1 = start of first child (paragraph)
      // pos + 2 = start of text inside paragraph
      const firstParagraphTextLength: number =
        newContent[0]?.textContent?.length ?? EMPTY_TEXT_LENGTH;
      const cursorPos: number = pos + PARAGRAPH_TEXT_OFFSET + firstParagraphTextLength;

      try {
        const resolvedPos: ReturnType<typeof tr.doc.resolve> = tr.doc.resolve(cursorPos);
        tr.setSelection(TextSelection.create(tr.doc, resolvedPos.pos));
      } catch {
        // If position resolution fails, just return the transaction without selection change
      }

      return tr;
    },
  });
});

/**
 * All GitHub alert plugins combined.
 */
export const githubAlertPlugin: MilkdownPlugin[] = [
  ...remarkGithubAlert,
  alertBlockNode,
  wrapInNoteAlertCommand,
  wrapInTipAlertCommand,
  wrapInImportantAlertCommand,
  wrapInWarningAlertCommand,
  wrapInCautionAlertCommand,
  blockquoteToAlertPlugin,
];
