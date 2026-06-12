import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import {
  MarkdownBlockType,
  MarkdownCommands,
} from '../../../../../services/markdown-commands/markdown-commands';
import { RibbonButton } from '../../controls/ribbon-button/ribbon-button';
import { RibbonButtonSmall } from '../../controls/ribbon-button-small/ribbon-button-small';
import { RibbonColumn } from '../../controls/ribbon-column/ribbon-column';
import { RibbonField } from '../../controls/ribbon-field/ribbon-field';
import { RibbonGroup } from '../../controls/ribbon-group/ribbon-group';

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
 * Represents the contextual ribbon shown when a markdown tab is active. Its controls drive formatting
 * on the active markdown editor through the {@link MarkdownCommands} registry, and its style field
 * follows the cursor's block type.
 */
@Component({
  selector: 'app-markdown-ribbon',
  imports: [RibbonGroup, RibbonColumn, RibbonButton, RibbonButtonSmall, RibbonField],
  templateUrl: './markdown-ribbon.html',
  styleUrl: '../ribbon-row.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MarkdownRibbon {
  /**
   * Holds the markdown command registry the ribbon controls route through.
   */
  private readonly commands: MarkdownCommands = inject(MarkdownCommands);

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
