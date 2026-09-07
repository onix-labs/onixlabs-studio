import { ChangeDetectionStrategy, Component, input, InputSignal } from '@angular/core';
import { redoCommand, undoCommand } from '@milkdown/kit/plugin/history';
import {
  insertHrCommand,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  toggleStrongCommand,
  wrapInBulletListCommand,
  wrapInOrderedListCommand,
} from '@milkdown/preset-commonmark';
import { insertTableCommand, toggleStrikethroughCommand } from '@milkdown/preset-gfm';
import { callCommand } from '@milkdown/utils';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { MarkdownEditor } from '@shared/angular/components/markdown-editor/markdown-editor';
import { PanelToolbar } from '@shared/angular/components/panel-toolbar/panel-toolbar';
import { TooltipTrigger } from '@shared/angular/components/tooltip/tooltip-trigger';
import { Icon } from '@shared/angular/icons/icon';
import { toggleTaskList } from '@shared/angular/milkdown/markdown-task-list';

/**
 * Represents the compact formatting tool-strip for a markdown editor pane: the basic editing
 * capabilities — history, inline marks, lists, and the table and divider blocks — as a single
 * seamless row.
 *
 * The full markdown tab already presents these through its ribbon; this strip exists for the other
 * surfaces that host the shared editor without one (the workspace document well and the agent
 * composer's markdown modal), so a table can be inserted or a divider removed anywhere the editor
 * appears. It drives its commands directly against the pane it is given — it does not register with
 * the {@link import('@shared/angular/services/markdown-commands/markdown-commands').MarkdownCommands}
 * registry, which belongs to the ribbon's one-active-document model.
 */
@Component({
  selector: 'app-markdown-toolstrip',
  imports: [AppIcon, PanelToolbar, TooltipTrigger],
  templateUrl: './markdown-toolstrip.html',
  styleUrl: './markdown-toolstrip.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MarkdownToolstrip {
  /**
   * Gets the icon tokens for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the markdown editor pane this strip drives, or undefined while the pane is still booting
   * (the strip's buttons no-op until it exists).
   */
  public readonly editor: InputSignal<MarkdownEditor | undefined> = input<MarkdownEditor>();

  /**
   * Undoes the last edit.
   */
  protected onUndo(): void {
    this.editor()?.run(callCommand(undoCommand.key));
  }

  /**
   * Redoes the last undone edit.
   */
  protected onRedo(): void {
    this.editor()?.run(callCommand(redoCommand.key));
  }

  /**
   * Toggles bold (strong) formatting on the selection.
   */
  protected onBold(): void {
    this.editor()?.run(callCommand(toggleStrongCommand.key));
  }

  /**
   * Toggles italic (emphasis) formatting on the selection.
   */
  protected onItalic(): void {
    this.editor()?.run(callCommand(toggleEmphasisCommand.key));
  }

  /**
   * Toggles strikethrough formatting on the selection.
   */
  protected onStrikethrough(): void {
    this.editor()?.run(callCommand(toggleStrikethroughCommand.key));
  }

  /**
   * Toggles inline code formatting on the selection.
   */
  protected onInlineCode(): void {
    this.editor()?.run(callCommand(toggleInlineCodeCommand.key));
  }

  /**
   * Wraps the current block(s) in a bullet list.
   */
  protected onBulletList(): void {
    this.editor()?.run(callCommand(wrapInBulletListCommand.key));
  }

  /**
   * Wraps the current block(s) in an ordered list.
   */
  protected onOrderedList(): void {
    this.editor()?.run(callCommand(wrapInOrderedListCommand.key));
  }

  /**
   * Toggles a task (checkbox) list on the current block(s).
   */
  protected onTaskList(): void {
    this.editor()?.run(toggleTaskList);
  }

  /**
   * Inserts a table at the cursor.
   */
  protected onTable(): void {
    this.editor()?.run(callCommand(insertTableCommand.key));
  }

  /**
   * Inserts a horizontal rule at the cursor.
   */
  protected onDivider(): void {
    this.editor()?.run(callCommand(insertHrCommand.key));
  }
}
