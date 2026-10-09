import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  InputSignal,
  output,
  OutputEmitterRef,
  OutputRefSubscription,
  signal,
  Signal,
  WritableSignal,
} from '@angular/core';
import type { Selection } from '@milkdown/kit/prose/state';
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
import { Dropdown, DropdownOption } from '@shared/angular/components/forms/dropdown/dropdown';
import {
  applyBlockType,
  BLOCK_TYPE_LABELS,
  blockTypeAt,
} from '@shared/angular/milkdown/markdown-block-type';
import { MarkdownBlockType } from '@shared/angular/services/markdown-commands/markdown-commands';
import { CdkMenuTrigger } from '@angular/cdk/menu';
import { Menu, MenuItem } from '@shared/angular/components/menu/menu';
import {
  DocumentFileCommands,
  injectDocumentFileCommands,
} from '@shared/angular/services/document-file-commands/document-file-commands';

/**
 * Identifies the Open in Tab command on the strip's menu.
 */
const MENU_OPEN_IN_TAB: string = 'markdown.openInTab';

/**
 * The format dropdown's options: every block type, in the words the markdown tab's ribbon uses.
 */
const BLOCK_TYPE_OPTIONS: readonly DropdownOption[] = Array.from(
  BLOCK_TYPE_LABELS,
  ([value, label]: [MarkdownBlockType, string]): DropdownOption => ({ value, label }),
);

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
  imports: [Button, CdkMenuTrigger, Dropdown, Menu],
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
   * Gets whether the menu offers Open in Tab. Enabled by hosts (the document well) whose document can
   * also be presented as its own tab.
   */
  public readonly showOpenInTab: InputSignal<boolean> = input<boolean>(false);

  /**
   * Gets the document's path, or null while it is untitled — which the menu's file commands act on.
   */
  public readonly filePath: InputSignal<string | null> = input<string | null>(null);

  /**
   * Emits when Open in Tab is chosen, so the host can open its document as a tab.
   */
  public readonly openInTab: OutputEmitterRef<void> = output<void>();

  /**
   * Holds the file commands the menu ends with, shared with the code strip's.
   */
  private readonly fileCommands: DocumentFileCommands = injectDocumentFileCommands();

  /**
   * Gets the menu's items: Open in Tab, when the host offers it, then the file's commands.
   */
  protected readonly menuItems: Signal<readonly MenuItem[]> = computed((): readonly MenuItem[] => [
    ...(this.showOpenInTab()
      ? [
          { id: MENU_OPEN_IN_TAB, label: 'Open in Tab', icon: Icon.OPEN_EXTERNAL },
          { id: 'separator', label: '', separator: true },
        ]
      : []),
    ...this.fileCommands.items(this.filePath()),
  ]);

  /**
   * Runs a command chosen from the strip's menu.
   * @param id The chosen item's identifier.
   */
  protected onMenu(id: string): void {
    if (id === MENU_OPEN_IN_TAB) {
      this.openInTab.emit();
      return;
    }
    this.fileCommands.run(id, this.filePath());
  }

  /**
   * Gets the format dropdown's options.
   */
  protected readonly blockTypeOptions: readonly DropdownOption[] = BLOCK_TYPE_OPTIONS;

  /**
   * Holds the block type at the cursor — what the format dropdown shows (#882).
   */
  protected readonly blockType: WritableSignal<MarkdownBlockType> =
    signal<MarkdownBlockType>('paragraph');

  /**
   * Initializes a new instance of the {@link MarkdownToolstrip} class, following the cursor of the
   * pane it drives so the format dropdown shows what the cursor is in, as the ribbon's does.
   */
  public constructor() {
    effect((onCleanup: (cleanup: () => void) => void): void => {
      const pane: MarkdownEditor | undefined = this.editor();
      if (pane === undefined) {
        return;
      }
      const selection: Selection | undefined = pane.getEditorView()?.state.selection;
      if (selection !== undefined) {
        this.blockType.set(blockTypeAt(selection));
      }
      const subscription: OutputRefSubscription = pane.selectionChange.subscribe(
        (next: Selection): void => this.blockType.set(blockTypeAt(next)),
      );
      onCleanup((): void => subscription.unsubscribe());
    });
  }

  /**
   * Turns the block at the cursor into the type chosen in the format dropdown.
   * @param value The chosen block type.
   */
  protected onBlockType(value: string): void {
    const pane: MarkdownEditor | undefined = this.editor();
    if (pane === undefined || !BLOCK_TYPE_LABELS.has(value as MarkdownBlockType)) {
      return;
    }
    applyBlockType(pane, value as MarkdownBlockType);
    this.blockType.set(value as MarkdownBlockType);
  }

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
