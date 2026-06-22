import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import {
  MarkdownBlockType,
  MarkdownCommands,
} from '../../../../../services/markdown-commands/markdown-commands';
import { Documents } from '../../../../../services/documents/documents';
import { Icon } from '../../../../../icons/icon';
import { RibbonButton } from '../../controls/ribbon-button/ribbon-button';
import { RibbonButtonSmall } from '../../controls/ribbon-button-small/ribbon-button-small';
import { RibbonColumn } from '../../controls/ribbon-column/ribbon-column';
import { RibbonField } from '../../controls/ribbon-field/ribbon-field';
import { RibbonGroup } from '../../controls/ribbon-group/ribbon-group';
import {
  RibbonMenuButton,
  RibbonMenuItem,
} from '../../controls/ribbon-menu-button/ribbon-menu-button';
import { RibbonRow } from '../../controls/ribbon-row/ribbon-row';

/**
 * Maps each selectable block type to the label shown in the ribbon's style field.
 */
const BLOCK_TYPE_LABELS: ReadonlyMap<MarkdownBlockType, string> = new Map<
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
 * Maps each style-field label back to its block type.
 */
const LABEL_BLOCK_TYPES: ReadonlyMap<string, MarkdownBlockType> = new Map<
  string,
  MarkdownBlockType
>(
  Array.from(
    BLOCK_TYPE_LABELS,
    ([type, label]: [MarkdownBlockType, string]): [string, MarkdownBlockType] => [label, type],
  ),
);

/**
 * Holds the label shown when the cursor's block type has no entry in the style field.
 */
const DEFAULT_BLOCK_LABEL: string = 'Paragraph';

/**
 * Identifies the markdown variant of a clipboard dropdown item, preserving formatting.
 */
const VARIANT_MARKDOWN: string = 'markdown';

/**
 * Identifies the plain-text variant of a clipboard dropdown item, discarding formatting.
 */
const VARIANT_PLAINTEXT: string = 'plaintext';

/**
 * Identifies the paste-as-code-block dropdown item.
 */
const VARIANT_CODE: string = 'code';

/**
 * Identifies the Save menu's save-as dropdown item.
 */
const VARIANT_SAVE_AS: string = 'save-as';

/**
 * Identifies the Save menu's export-to-PDF dropdown item.
 */
const VARIANT_EXPORT_PDF: string = 'export-pdf';

/**
 * Represents the contextual ribbon shown when a markdown tab is active. Its controls drive formatting
 * on the active markdown editor through the {@link MarkdownCommands} registry, and its style field
 * follows the cursor's block type.
 */
@Component({
  selector: 'app-markdown-ribbon',
  imports: [
    RibbonGroup,
    RibbonColumn,
    RibbonButton,
    RibbonButtonSmall,
    RibbonField,
    RibbonMenuButton,
    RibbonRow,
  ],
  templateUrl: './markdown-ribbon.html',
  styleUrls: ['../ribbon-row.scss', './markdown-ribbon.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MarkdownRibbon {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the markdown command registry the ribbon controls route through.
   */
  private readonly commands: MarkdownCommands = inject(MarkdownCommands);

  /**
   * Holds the documents service backing the file actions.
   */
  private readonly documents: Documents = inject(Documents);

  /**
   * Gets the variants offered by the File group's Save menu button.
   */
  protected readonly saveItems: readonly RibbonMenuItem[] = [
    { id: VARIANT_SAVE_AS, label: 'Save As', icon: Icon.SAVE_AS },
    { id: VARIANT_EXPORT_PDF, label: 'Export to PDF', icon: Icon.EXPORT_PDF },
  ];

  /**
   * Gets the cut variants offered by the Clipboard group's Cut menu button.
   */
  protected readonly cutItems: readonly RibbonMenuItem[] = [
    { id: VARIANT_MARKDOWN, label: 'Cut as Markdown', icon: Icon.MARKDOWN },
    { id: VARIANT_PLAINTEXT, label: 'Cut as Plain Text', icon: Icon.CUT },
  ];

  /**
   * Gets the copy variants offered by the Clipboard group's Copy menu button.
   */
  protected readonly copyItems: readonly RibbonMenuItem[] = [
    { id: VARIANT_MARKDOWN, label: 'Copy as Markdown', icon: Icon.MARKDOWN },
    { id: VARIANT_PLAINTEXT, label: 'Copy as Plain Text', icon: Icon.COPY },
  ];

  /**
   * Gets the paste variants offered by the Clipboard group's Paste menu button.
   */
  protected readonly pasteItems: readonly RibbonMenuItem[] = [
    { id: VARIANT_MARKDOWN, label: 'Paste as Markdown', icon: Icon.MARKDOWN },
    { id: VARIANT_PLAINTEXT, label: 'Paste as Plain Text', icon: Icon.PASTE },
    { id: VARIANT_CODE, label: 'Paste as Code Block', icon: Icon.CODE_INLINE },
  ];

  /**
   * Cuts the selection in the active editor as markdown, the Cut button's default action.
   */
  protected onCut(): void {
    this.commands.cut();
  }

  /**
   * Cuts the selection using the variant chosen from the Cut menu button's dropdown.
   * @param id The chosen cut variant's identifier.
   */
  protected onCutVariant(id: string): void {
    if (id === VARIANT_PLAINTEXT) {
      this.commands.cutAsPlaintext();
    } else {
      this.commands.cut();
    }
  }

  /**
   * Copies the selection in the active editor as markdown, the Copy button's default action.
   */
  protected onCopy(): void {
    this.commands.copy();
  }

  /**
   * Copies the selection using the variant chosen from the Copy menu button's dropdown.
   * @param id The chosen copy variant's identifier.
   */
  protected onCopyVariant(id: string): void {
    if (id === VARIANT_PLAINTEXT) {
      this.commands.copyAsPlaintext();
    } else {
      this.commands.copy();
    }
  }

  /**
   * Pastes the clipboard contents into the active editor as markdown, the Paste button's default
   * action.
   */
  protected onPaste(): void {
    this.commands.paste();
  }

  /**
   * Pastes the clipboard contents using the variant chosen from the Paste menu button's dropdown.
   * @param id The chosen paste variant's identifier.
   */
  protected onPasteVariant(id: string): void {
    switch (id) {
      case VARIANT_PLAINTEXT:
        this.commands.pasteAsPlaintext();
        break;
      case VARIANT_CODE:
        this.commands.pasteAsCode();
        break;
      default:
        this.commands.paste();
        break;
    }
  }

  /**
   * Saves the active document, the Save button's default action. A document that already has a file
   * is written in place; a new document falls through to a Save As dialog.
   */
  protected onSave(): void {
    void this.documents.saveActive();
  }

  /**
   * Runs the action chosen from the Save menu button's dropdown.
   * @param id The chosen save variant's identifier.
   */
  protected onSaveVariant(id: string): void {
    switch (id) {
      case VARIANT_SAVE_AS:
        void this.documents.saveActiveAs();
        break;
      case VARIANT_EXPORT_PDF:
        this.onExportPdf();
        break;
      default:
        void this.documents.saveActive();
        break;
    }
  }

  /**
   * Exports the active document to PDF.
   *
   * TODO: PDF export is not yet implemented; this is a stub until that lands.
   */
  protected onExportPdf(): void {
    // Intentionally empty until PDF export is implemented.
  }

  /**
   * Prints the active document via the browser print dialog.
   */
  protected onPrint(): void {
    window.print();
  }

  /**
   * Toggles a task list on the current block(s).
   *
   * TODO: the Milkdown task-list command is not yet wired into the editor command handler; this is a
   * placeholder until that lands.
   */
  protected onTaskList(): void {
    // Intentionally empty until the editor exposes a task-list command.
  }

  /**
   * Gets the labels offered by the block style field, in display order.
   */
  protected readonly blockOptions: readonly string[] = Array.from(BLOCK_TYPE_LABELS.values());

  /**
   * Gets the label of the block type at the editor's current selection.
   */
  protected readonly blockLabel: Signal<string> = computed(
    (): string => BLOCK_TYPE_LABELS.get(this.commands.activeBlockType()) ?? DEFAULT_BLOCK_LABEL,
  );

  /**
   * Toggles bold formatting on the selection.
   */
  protected onBold(): void {
    this.commands.toggleBold();
  }

  /**
   * Toggles italic formatting on the selection.
   */
  protected onItalic(): void {
    this.commands.toggleItalic();
  }

  /**
   * Toggles strikethrough formatting on the selection.
   */
  protected onStrikethrough(): void {
    this.commands.toggleStrikethrough();
  }

  /**
   * Toggles inline code formatting on the selection.
   */
  protected onInlineCode(): void {
    this.commands.toggleInlineCode();
  }

  /**
   * Wraps the current block(s) in a bullet list.
   */
  protected onBulletList(): void {
    this.commands.toggleBulletList();
  }

  /**
   * Wraps the current block(s) in an ordered list.
   */
  protected onOrderedList(): void {
    this.commands.toggleOrderedList();
  }

  /**
   * Inserts a table at the cursor.
   */
  protected onTable(): void {
    this.commands.insertTable();
  }

  /**
   * Inserts a horizontal rule at the cursor.
   */
  protected onDivider(): void {
    this.commands.insertHorizontalRule();
  }

  /**
   * Applies the block type chosen in the style field.
   * @param label The selected style label.
   */
  protected onBlockChange(label: string): void {
    const blockType: MarkdownBlockType | undefined = LABEL_BLOCK_TYPES.get(label);
    if (blockType !== undefined) {
      this.commands.setBlockType(blockType);
    }
  }
}
