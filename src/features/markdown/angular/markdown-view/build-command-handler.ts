import {
  insertHrCommand,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  toggleStrongCommand,
  wrapInBulletListCommand,
  wrapInOrderedListCommand,
} from '@milkdown/preset-commonmark';
import { insertTableCommand, toggleStrikethroughCommand } from '@milkdown/preset-gfm';
import { redoCommand, undoCommand } from '@milkdown/kit/plugin/history';
import { callCommand } from '@milkdown/utils';
import { MarkdownEditor } from '@shared/angular/components/markdown-editor/markdown-editor';
import {
  MarkdownBlockType,
  MarkdownCommandHandler,
} from '@shared/angular/services/markdown-commands/markdown-commands';
import { MarkdownClipboard } from './markdown-clipboard';
import { OutlineScrollSpy } from './outline-scroll-spy';
import { toggleTaskList } from './markdown-task-list';

/**
 * Describes the collaborators a {@link MarkdownCommandHandler} routes the ribbon's commands to. The
 * handler is pure wiring: clipboard and insertion commands go to the {@link MarkdownClipboard}, the
 * heading jump to the {@link OutlineScrollSpy}, block-type changes to the owning view's applier, and
 * the remaining formatting and history commands run directly against the live pane.
 */
export interface MarkdownCommandHandlerDeps {
  /**
   * Gets the clipboard and insertion command runner.
   */
  readonly clipboard: MarkdownClipboard;

  /**
   * Gets the outline scroll-spy the heading jump routes to.
   */
  readonly outline: OutlineScrollSpy;

  /**
   * Gets the accessor for the live editor pane.
   */
  readonly paneOf: () => MarkdownEditor | undefined;

  /**
   * Applies a block type to the current block. Owned by the view because it shares the block-type
   * command table with the ribbon's active-block-type reflection.
   */
  readonly setBlockType: (blockType: MarkdownBlockType) => void;
}

/**
 * Builds the ribbon command handler for a markdown editor, mapping each command to a pane action or a
 * collaborator. Pure: it captures the supplied dependencies and returns the handler, registering
 * nothing itself.
 * @param deps The collaborators the handler routes to.
 * @returns Returns the assembled command handler.
 */
export function buildMarkdownCommandHandler(
  deps: MarkdownCommandHandlerDeps,
): MarkdownCommandHandler {
  return {
    cut: (): void => deps.clipboard.clipboardCommand('cut'),
    cutAsPlaintext: (): void => deps.clipboard.cutPlaintext(),
    copy: (): void => deps.clipboard.clipboardCommand('copy'),
    copyAsPlaintext: (): void => deps.clipboard.copyPlaintext(),
    paste: (): void => deps.clipboard.pasteMarkdown(),
    pasteAsPlaintext: (): void => deps.clipboard.pastePlaintext(),
    pasteAsCode: (): void => deps.clipboard.pasteCode(),
    undo: (): void => deps.paneOf()?.run(callCommand(undoCommand.key)),
    redo: (): void => deps.paneOf()?.run(callCommand(redoCommand.key)),
    toggleBold: (): void => deps.paneOf()?.run(callCommand(toggleStrongCommand.key)),
    toggleItalic: (): void => deps.paneOf()?.run(callCommand(toggleEmphasisCommand.key)),
    toggleStrikethrough: (): void =>
      deps.paneOf()?.run(callCommand(toggleStrikethroughCommand.key)),
    toggleInlineCode: (): void => deps.paneOf()?.run(callCommand(toggleInlineCodeCommand.key)),
    toggleBulletList: (): void => deps.paneOf()?.run(callCommand(wrapInBulletListCommand.key)),
    toggleOrderedList: (): void => deps.paneOf()?.run(callCommand(wrapInOrderedListCommand.key)),
    toggleTaskList: (): void => deps.paneOf()?.run(toggleTaskList),
    insertTable: (): void => deps.paneOf()?.run(callCommand(insertTableCommand.key)),
    insertHorizontalRule: (): void => deps.paneOf()?.run(callCommand(insertHrCommand.key)),
    insertMarkdown: (markdown: string): void => deps.clipboard.insertParsedBlock(markdown),
    insertInlineMarkdown: (markdown: string): void => deps.clipboard.insertParsedInline(markdown),
    insertText: (text: string): void => deps.clipboard.insertRawText(text),
    appendMarkdown: (markdown: string): void => deps.clipboard.appendParsedBlock(markdown),
    setBlockType: (blockType: MarkdownBlockType): void => deps.setBlockType(blockType),
    goToHeading: (index: number): void => deps.outline.goToHeading(index),
    readDocument: (): string => deps.paneOf()?.getMarkdown() ?? '',
    replaceDocument: (markdown: string): void => deps.paneOf()?.replaceAll(markdown),
  };
}
