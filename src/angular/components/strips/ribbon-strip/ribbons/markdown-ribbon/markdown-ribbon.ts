import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  Signal,
  WritableSignal,
} from '@angular/core';
import {
  MarkdownBlockType,
  MarkdownCommands,
} from '../../../../../services/markdown-commands/markdown-commands';
import { Documents } from '../../../../../services/documents/documents';
import { Icon } from '../../../../../icons/icon';
import { RibbonStripButtonSmall } from '../../ribbon-strip-button-small/ribbon-strip-button-small';
import { RibbonStripColumn } from '../../ribbon-strip-column/ribbon-strip-column';
import { RibbonStripField } from '../../ribbon-strip-field/ribbon-strip-field';
import { RibbonStripGroup } from '../../ribbon-strip-group/ribbon-strip-group';
import {
  RibbonStripMenuButton,
  RibbonMenuItem,
} from '../../ribbon-strip-menu-button/ribbon-strip-menu-button';
import { RibbonStripRow } from '../../ribbon-strip-row/ribbon-strip-row';
import { CollapseInsert, MarkdownCollapseModal } from './insert-modals/markdown-collapse-modal';
import { MarkdownEmojiModal } from './insert-modals/markdown-emoji-modal';
import { FootnoteInsert, MarkdownFootnoteModal } from './insert-modals/markdown-footnote-modal';
import { ImageInsert, MarkdownImageModal } from './insert-modals/markdown-image-modal';
import { LinkInsert, MarkdownLinkModal } from './insert-modals/markdown-link-modal';
import { MarkdownMathModal, MathInsert } from './insert-modals/markdown-math-modal';

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
 * Identifies the bulleted-list item in the List menu button's dropdown.
 */
const VARIANT_BULLET_LIST: string = 'bullet-list';

/**
 * Identifies the numbered-list item in the List menu button's dropdown.
 */
const VARIANT_NUMBERED_LIST: string = 'numbered-list';

/**
 * Identifies the task-list item in the List menu button's dropdown.
 */
const VARIANT_TASK_LIST: string = 'task-list';

/**
 * Identifies the items in the Blocks menu button's dropdown.
 */
const VARIANT_TABLE: string = 'table';
const VARIANT_DIVIDER: string = 'divider';
const VARIANT_COLLAPSE: string = 'collapse';

/**
 * Identifies the items in the Media menu button's dropdown.
 */
const VARIANT_IMAGE: string = 'image';
const VARIANT_DIAGRAM: string = 'diagram';
const VARIANT_MATH: string = 'math';

/**
 * Identifies the items in the Inline menu button's dropdown.
 */
const VARIANT_LINK: string = 'link';
const VARIANT_FOOTNOTE: string = 'footnote';
const VARIANT_EMOJI: string = 'emoji';

/**
 * Represents the contextual ribbon shown when a markdown tab is active. Its controls drive formatting
 * on the active markdown editor through the {@link MarkdownCommands} registry, and its style field
 * follows the cursor's block type.
 */
@Component({
  selector: 'app-markdown-ribbon',
  imports: [
    RibbonStripGroup,
    RibbonStripColumn,
    RibbonStripButtonSmall,
    RibbonStripField,
    RibbonStripMenuButton,
    RibbonStripRow,
    MarkdownImageModal,
    MarkdownLinkModal,
    MarkdownMathModal,
    MarkdownCollapseModal,
    MarkdownFootnoteModal,
    MarkdownEmojiModal,
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
  ];

  /**
   * Gets the variants offered by the File group's Print menu button.
   */
  protected readonly printItems: readonly RibbonMenuItem[] = [
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
   * Gets the list types offered by the Lists menu button. The button itself inserts a bulleted list;
   * the dropdown offers all three.
   */
  protected readonly listItems: readonly RibbonMenuItem[] = [
    { id: VARIANT_BULLET_LIST, label: 'Bulleted List', icon: Icon.BULLET_LIST },
    { id: VARIANT_NUMBERED_LIST, label: 'Numbered List', icon: Icon.NUMBERED_LIST },
    { id: VARIANT_TASK_LIST, label: 'Task List', icon: Icon.TASK_LIST },
  ];

  /**
   * Gets the block structures offered by the Blocks menu button. The button itself inserts a table.
   */
  protected readonly blockItems: readonly RibbonMenuItem[] = [
    { id: VARIANT_TABLE, label: 'Table', icon: Icon.TABLE },
    { id: VARIANT_DIVIDER, label: 'Divider', icon: Icon.DIVIDER },
    { id: VARIANT_COLLAPSE, label: 'Collapsible Block', icon: Icon.COLLAPSE },
  ];

  /**
   * Gets the embeds offered by the Media menu button. The button itself inserts an image.
   */
  protected readonly mediaItems: readonly RibbonMenuItem[] = [
    { id: VARIANT_IMAGE, label: 'Image', icon: Icon.IMAGE },
    { id: VARIANT_DIAGRAM, label: 'Diagram', icon: Icon.DIAGRAM },
    { id: VARIANT_MATH, label: 'Math', icon: Icon.MATH },
  ];

  /**
   * Gets the inline elements offered by the Inline menu button. The button itself inserts a link.
   */
  protected readonly inlineItems: readonly RibbonMenuItem[] = [
    { id: VARIANT_LINK, label: 'Link', icon: Icon.LINK },
    { id: VARIANT_FOOTNOTE, label: 'Footnote', icon: Icon.FOOTNOTE },
    { id: VARIANT_EMOJI, label: 'Emoji', icon: Icon.EMOJI },
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
    if (id === VARIANT_SAVE_AS) {
      void this.documents.saveActiveAs();
    } else {
      void this.documents.saveActive();
    }
  }

  /**
   * Runs the action chosen from the Print menu button's dropdown.
   * @param id The chosen print variant's identifier.
   */
  protected onPrintVariant(id: string): void {
    if (id === VARIANT_EXPORT_PDF) {
      this.onExportPdf();
    } else {
      this.onPrint();
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
   * Applies the list type chosen from the Lists menu button's dropdown.
   * @param id The chosen list variant's identifier.
   */
  protected onListVariant(id: string): void {
    switch (id) {
      case VARIANT_NUMBERED_LIST:
        this.onOrderedList();
        break;
      case VARIANT_TASK_LIST:
        this.onTaskList();
        break;
      default:
        this.onBulletList();
        break;
    }
  }

  /**
   * Inserts the block structure chosen from the Blocks menu button's dropdown.
   * @param id The chosen block variant's identifier.
   */
  protected onBlockVariant(id: string): void {
    switch (id) {
      case VARIANT_DIVIDER:
        this.onDivider();
        break;
      case VARIANT_COLLAPSE:
        this.onCollapse();
        break;
      default:
        this.onTable();
        break;
    }
  }

  /**
   * Inserts the embed chosen from the Media menu button's dropdown.
   * @param id The chosen media variant's identifier.
   */
  protected onMediaVariant(id: string): void {
    switch (id) {
      case VARIANT_DIAGRAM:
        this.onDiagram();
        break;
      case VARIANT_MATH:
        this.onMath();
        break;
      default:
        this.onImage();
        break;
    }
  }

  /**
   * Inserts the inline element chosen from the Inline menu button's dropdown.
   * @param id The chosen inline variant's identifier.
   */
  protected onInlineVariant(id: string): void {
    switch (id) {
      case VARIANT_FOOTNOTE:
        this.onFootnote();
        break;
      case VARIANT_EMOJI:
        this.onEmoji();
        break;
      default:
        this.onLink();
        break;
    }
  }

  /**
   * Holds whether the image insert modal is open.
   */
  protected readonly imageOpen: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds whether the link insert modal is open.
   */
  protected readonly linkOpen: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds whether the math insert modal is open.
   */
  protected readonly mathOpen: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds whether the collapsible-block insert modal is open.
   */
  protected readonly collapseOpen: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds whether the footnote insert modal is open.
   */
  protected readonly footnoteOpen: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds whether the emoji insert modal is open.
   */
  protected readonly emojiOpen: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Counts inserted footnotes so each unlabelled footnote gets a unique reference.
   */
  private footnoteCounter: number = 0;

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
   * Opens the image insert modal.
   */
  protected onImage(): void {
    this.imageOpen.set(true);
  }

  /**
   * Inserts the image chosen in the modal as a markdown image.
   * @param image The image source and alt text.
   */
  protected onImageSubmit(image: ImageInsert): void {
    this.commands.insertMarkdown(`![${image.alt}](${image.url})`);
  }

  /**
   * Opens the link insert modal.
   */
  protected onLink(): void {
    this.linkOpen.set(true);
  }

  /**
   * Inserts the link chosen in the modal at the cursor.
   * @param link The link text and URL.
   */
  protected onLinkSubmit(link: LinkInsert): void {
    const text: string = link.text.length > 0 ? link.text : link.url;
    this.commands.insertInlineMarkdown(`[${text}](${link.url})`);
  }

  /**
   * Opens the math insert modal.
   */
  protected onMath(): void {
    this.mathOpen.set(true);
  }

  /**
   * Inserts the math expression chosen in the modal, as a block or inline formula.
   * @param math The expression and whether it is a block formula.
   */
  protected onMathSubmit(math: MathInsert): void {
    if (math.block) {
      this.commands.insertMarkdown(`$$\n${math.expression}\n$$`);
    } else {
      this.commands.insertInlineMarkdown(`$${math.expression}$`);
    }
  }

  /**
   * Inserts a starter Mermaid diagram block at the cursor, edited live in the editor.
   */
  protected onDiagram(): void {
    this.commands.insertMarkdown('```mermaid\nflowchart TD\n  A[Start] --> B[End]\n```');
  }

  /**
   * Opens the footnote insert modal.
   */
  protected onFootnote(): void {
    this.footnoteOpen.set(true);
  }

  /**
   * Inserts the footnote chosen in the modal: a reference at the cursor and a definition appended to
   * the document.
   * @param footnote The footnote reference label and content.
   */
  protected onFootnoteSubmit(footnote: FootnoteInsert): void {
    const sanitized: string = footnote.label.replace(/\s+/g, '-');
    const reference: string = sanitized.length > 0 ? sanitized : `fn-${++this.footnoteCounter}`;
    this.commands.insertInlineMarkdown(`[^${reference}]`);
    this.commands.appendMarkdown(`[^${reference}]: ${footnote.content}`);
  }

  /**
   * Opens the collapsible-block insert modal.
   */
  protected onCollapse(): void {
    this.collapseOpen.set(true);
  }

  /**
   * Inserts the collapsible (details/summary) block chosen in the modal.
   * @param collapse The block summary and optional body.
   */
  protected onCollapseSubmit(collapse: CollapseInsert): void {
    const body: string = collapse.body.length > 0 ? collapse.body : '';
    this.commands.insertMarkdown(
      `<details>\n<summary>${collapse.summary}</summary>\n\n${body}\n\n</details>`,
    );
  }

  /**
   * Opens the emoji insert modal.
   */
  protected onEmoji(): void {
    this.emojiOpen.set(true);
  }

  /**
   * Inserts the emoji chosen in the modal at the cursor.
   * @param emoji The chosen emoji's Unicode character.
   */
  protected onEmojiSubmit(emoji: string): void {
    this.commands.insertText(emoji);
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
