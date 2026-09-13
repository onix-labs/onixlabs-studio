import {
  ChangeDetectionStrategy,
  Component,
  input,
  InputSignal,
  output,
  OutputEmitterRef,
} from '@angular/core';
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
import { Button } from '@shared/angular/components/forms/button/button';
import { MarkdownEditor } from '@shared/angular/components/markdown-editor/markdown-editor';
import { Icon } from '@shared/angular/icons/icon';
import { toggleTaskList } from '@shared/angular/milkdown/markdown-task-list';

/**
 * Represents the compact formatting tool-strip for a markdown editor pane: the basic editing
 * capabilities — history, inline marks, lists, and the table and divider blocks — as a single
 * seamless row of the same icon buttons the explorer tool strips use.
 *
 * The full markdown tab already presents these through its ribbon; this strip exists for the
 * surfaces that host the shared editor without one (the workspace document well), so a table can be
 * inserted or a divider removed there too. It drives its commands directly against the pane it is
 * given — it does not register with the
 * {@link import('@shared/angular/services/markdown-commands/markdown-commands').MarkdownCommands}
 * registry, which belongs to the ribbon's one-active-document model. A host that can present the
 * document as its own tab enables the trailing open-in-tab button and handles the emitted intent.
 */
@Component({
  selector: 'app-markdown-toolstrip',
  imports: [Button],
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
   * Gets whether the trailing open-in-tab button is shown. Enabled by hosts (the document well)
   * whose document can also be presented as its own tab.
   */
  public readonly showOpenInTab: InputSignal<boolean> = input<boolean>(false);

  /**
   * Emits when the open-in-tab button is pressed, so the host can open its document as a tab.
   */
  public readonly openInTab: OutputEmitterRef<void> = output<void>();

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
