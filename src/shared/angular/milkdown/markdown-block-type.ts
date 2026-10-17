import { type Node as ProseMirrorNode } from '@milkdown/kit/prose/model';
import type { Selection } from '@milkdown/kit/prose/state';
import {
  createCodeBlockCommand,
  turnIntoTextCommand,
  wrapInBlockquoteCommand,
  wrapInHeadingCommand,
} from '@milkdown/preset-commonmark';
import { callCommand } from '@milkdown/utils';
import { MarkdownEditor } from '@shared/angular/components/markdown-editor/markdown-editor';
import {
  wrapInCautionAlertCommand,
  wrapInImportantAlertCommand,
  wrapInNoteAlertCommand,
  wrapInTipAlertCommand,
  wrapInWarningAlertCommand,
} from '@shared/angular/milkdown/github-alert-plugin';
import { MarkdownBlockType } from '@shared/angular/services/markdown-commands/markdown-commands';

/**
 * The block types a markdown editor offers, each with the label its format dropdown shows — in the
 * order it shows them. Shared by the markdown tab's ribbon and the workspace well's tool strip, so the
 * two dropdowns list the same thing in the same words (#882).
 */
export const BLOCK_TYPE_LABELS: ReadonlyMap<MarkdownBlockType, string> = new Map<
  MarkdownBlockType,
  string
>([
  ['paragraph', 'Paragraph'],
  ['heading-1', 'Heading 1'],
  ['heading-2', 'Heading 2'],
  ['heading-3', 'Heading 3'],
  ['heading-4', 'Heading 4'],
  ['heading-5', 'Heading 5'],
  ['heading-6', 'Heading 6'],
  ['blockquote', 'Blockquote'],
  ['code-block', 'Code Block'],
  ['alert-note', 'Note'],
  ['alert-tip', 'Tip'],
  ['alert-important', 'Important'],
  ['alert-warning', 'Warning'],
  ['alert-caution', 'Caution'],
]);

/**
 * The depth of the document node, where the walk up from a selection stops.
 */
const ROOT_DEPTH: number = 0;

/**
 * Finds the block type of what a selection is in, walking up from it to the nearest block that has
 * one: a heading, a code block, a blockquote or an alert — or else a paragraph.
 * @param selection The editor's selection.
 * @returns Returns the block type at the selection.
 */
export function blockTypeAt(selection: Selection): MarkdownBlockType {
  const from: Selection['$from'] = selection.$from;
  for (let depth: number = from.depth; depth >= ROOT_DEPTH; depth--) {
    const node: ProseMirrorNode = from.node(depth);
    const name: string = node.type.name;
    if (name === 'heading') {
      return `heading-${node.attrs['level'] as number}` as MarkdownBlockType;
    }
    if (name === 'code_block') {
      return 'code-block';
    }
    if (name === 'blockquote') {
      return 'blockquote';
    }
    if (name === 'alert_block') {
      return `alert-${node.attrs['alertType'] as string}` as MarkdownBlockType;
    }
  }
  return 'paragraph';
}

/**
 * Turns the block at an editor's selection into another type.
 * @param pane The editor.
 * @param blockType The block type to turn it into.
 */
export function applyBlockType(pane: MarkdownEditor, blockType: MarkdownBlockType): void {
  switch (blockType) {
    case 'paragraph':
      pane.run(callCommand(turnIntoTextCommand.key));
      break;
    case 'blockquote':
      pane.run(callCommand(wrapInBlockquoteCommand.key));
      break;
    case 'code-block':
      pane.run(callCommand(createCodeBlockCommand.key));
      break;
    case 'heading-1':
    case 'heading-2':
    case 'heading-3':
    case 'heading-4':
    case 'heading-5':
    case 'heading-6':
      pane.run(callCommand(wrapInHeadingCommand.key, Number(blockType.slice('heading-'.length))));
      break;
    case 'alert-note':
      pane.run(callCommand(wrapInNoteAlertCommand.key));
      break;
    case 'alert-tip':
      pane.run(callCommand(wrapInTipAlertCommand.key));
      break;
    case 'alert-important':
      pane.run(callCommand(wrapInImportantAlertCommand.key));
      break;
    case 'alert-warning':
      pane.run(callCommand(wrapInWarningAlertCommand.key));
      break;
    case 'alert-caution':
      pane.run(callCommand(wrapInCautionAlertCommand.key));
      break;
  }
}
