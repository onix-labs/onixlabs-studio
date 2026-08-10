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
} from '@shared/angular/services/markdown-commands/markdown-commands';
import { Documents } from '@shared/angular/services/documents/documents';
import { Log } from '@shared/angular/services/log/log';
import { Printing } from '@shared/angular/services/printing/printing';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import {
  MarkdownPanels,
  OpenableMarkdownPanel,
} from '@features/markdown/angular/markdown-panels/markdown-panels';
import { Icon } from '@shared/angular/icons/icon';
import { RibbonHost } from '@shared/angular/components/ribbon-strip/ribbon-host/ribbon-host';
import { RibbonStripButton } from '@shared/angular/components/ribbon-strip/ribbon-strip-button/ribbon-strip-button';
import { RibbonStripButtonSmall } from '@shared/angular/components/ribbon-strip/ribbon-strip-button-small/ribbon-strip-button-small';
import { RibbonStripColumn } from '@shared/angular/components/ribbon-strip/ribbon-strip-column/ribbon-strip-column';
import { RibbonStripField } from '@shared/angular/components/ribbon-strip/ribbon-strip-field/ribbon-strip-field';
import { RibbonStripGroup } from '@shared/angular/components/ribbon-strip/ribbon-strip-group/ribbon-strip-group';
import { RibbonStripOverflow } from '@shared/angular/components/ribbon-strip/ribbon-strip-overflow/ribbon-strip-overflow';
import {
  RibbonStripMenuButton,
  RibbonMenuItem,
} from '@shared/angular/components/ribbon-strip/ribbon-strip-menu-button/ribbon-strip-menu-button';
import { RibbonStripRow } from '@shared/angular/components/ribbon-strip/ribbon-strip-row/ribbon-strip-row';
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
 * Represents the contextual ribbon shown when a markdown tab is active. Its controls drive formatting
 * on the active markdown editor through the {@link MarkdownCommands} registry, and its style field
 * follows the cursor's block type.
 */
@Component({
  selector: 'app-markdown-ribbon',
  imports: [
    RibbonStripOverflow,
    RibbonStripGroup,
    RibbonStripColumn,
    RibbonStripButton,
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
  styleUrl: './markdown-ribbon.scss',
  hostDirectives: [RibbonHost],
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
   * Holds the tabs service used to resolve the active document for print and export.
   */
  private readonly tabs: Tabs = inject(Tabs);

  /**
   * Holds the printing service backing the Print and Export-to-PDF actions.
   */
  private readonly printing: Printing = inject(Printing);

  /**
   * Holds the tool-panel registry the Tools group toggles.
   */
  private readonly panels: MarkdownPanels = inject(MarkdownPanels);

  /**
   * Holds the structured logging client for the ribbon's user-initiated commands.
   */
  private readonly log: Log = inject(Log);

  /**
   * Gets the tool panels currently open, so each Tools button reflects its own pressed state (more
   * than one can be open at a time).
   */
  protected readonly openPanels: Signal<ReadonlySet<OpenableMarkdownPanel>> = this.panels.active;

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
   * Gets a value indicating whether there is an edit that can be undone.
   */
  protected readonly canUndo: Signal<boolean> = this.commands.canUndo;

  /**
   * Gets a value indicating whether there is an undone edit that can be redone.
   */
  protected readonly canRedo: Signal<boolean> = this.commands.canRedo;

  /**
   * Gets a value indicating whether the active document has any headings, so the Outline toggle is
   * disabled for a document with nothing to outline.
   */
  protected readonly hasHeadings: Signal<boolean> = computed(
    (): boolean => this.commands.outline().length > 0,
  );

  /**
   * Gets a value indicating whether the active document has no content, so the Review and Reader
   * toggles are disabled for a document with nothing to review or read. Read from the document store
   * (not the focus-scoped command state) so it stays correct while the editor is not focused.
   */
  protected readonly isDocumentEmpty: Signal<boolean> = computed((): boolean => {
    const id: string | undefined = this.tabs.activeTabId();
    const content: string =
      (id === undefined ? undefined : this.documents.get(id)?.content()) ?? '';
    return content.trim().length === 0;
  });

  /**
   * Undoes the last edit in the active editor.
   */
  protected onUndo(): void {
    this.commands.undo();
  }

  /**
   * Redoes the last undone edit in the active editor.
   */
  protected onRedo(): void {
    this.commands.redo();
  }

  /**
   * Toggles the Find tool panel on the active document.
   */
  protected onFind(): void {
    this.panels.toggle('find');
  }

  /**
   * Toggles the Outline tool panel.
   */
  protected onOutline(): void {
    this.panels.toggle('outline');
  }

  /**
   * Toggles the Review tool panel.
   */
  protected onReview(): void {
    this.panels.toggle('review');
  }

  /**
   * Toggles the Agent tool panel.
   */
  protected onAgent(): void {
    this.panels.toggle('agent');
  }

  /**
   * Toggles the Reader tool panel.
   */
  protected onReader(): void {
    this.panels.toggle('reader');
  }

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
    this.log.info('markdown.ribbon', 'Cut command', { variant: id });
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
    this.log.info('markdown.ribbon', 'Copy command', { variant: id });
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
    this.log.info('markdown.ribbon', 'Paste command', { variant: id });
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
    this.log.info('markdown.ribbon', 'Save requested');
    void this.documents.saveActive();
  }

  /**
   * Runs the action chosen from the Save menu button's dropdown.
   * @param id The chosen save variant's identifier.
   */
  protected onSaveVariant(id: string): void {
    this.log.info('markdown.ribbon', 'Save command', { variant: id });
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
   * Exports the active document to PDF, prompting for a destination and opening the result.
   */
  protected onExportPdf(): void {
    this.log.info('markdown.ribbon', 'Export to PDF requested', {
      name: this.activeDocumentName(),
    });
    void this.printing.exportPdf(this.activeDocumentName());
  }

  /**
   * Prints the active document via the browser print dialog.
   */
  protected onPrint(): void {
    this.log.info('markdown.ribbon', 'Print requested');
    this.printing.print();
  }

  /**
   * Gets the active document's name, used to seed the export file name.
   * @returns Returns the active document's name, or an empty string when none is active.
   */
  private activeDocumentName(): string {
    const id: string | undefined = this.tabs.activeTabId();
    return (id === undefined ? undefined : this.documents.get(id)?.fileName()) ?? '';
  }

  /**
   * Toggles a task (checkbox) list on the current block(s).
   */
  protected onTaskList(): void {
    this.log.info('markdown.ribbon', 'Task list toggled');
    this.commands.toggleTaskList();
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
    this.log.info('markdown.ribbon', 'Insert table');
    this.commands.insertTable();
  }

  /**
   * Inserts a horizontal rule at the cursor.
   */
  protected onDivider(): void {
    this.log.info('markdown.ribbon', 'Insert divider');
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
    this.log.info('markdown.ribbon', 'Insert image confirmed', { url: image.url });
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
    this.log.info('markdown.ribbon', 'Insert link confirmed', { url: link.url });
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
    this.log.info('markdown.ribbon', 'Insert math confirmed', { block: math.block });
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
    this.log.info('markdown.ribbon', 'Insert diagram');
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
    this.log.info('markdown.ribbon', 'Insert footnote confirmed', { reference });
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
    this.log.info('markdown.ribbon', 'Insert collapsible block confirmed');
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
    this.log.info('markdown.ribbon', 'Insert emoji confirmed', { emoji });
    this.commands.insertText(emoji);
  }

  /**
   * Applies the block type chosen in the style field.
   * @param label The selected style label.
   */
  protected onBlockChange(label: string): void {
    const blockType: MarkdownBlockType | undefined = LABEL_BLOCK_TYPES.get(label);
    if (blockType !== undefined) {
      this.log.debug('markdown.ribbon', 'Block style changed', { blockType });
      this.commands.setBlockType(blockType);
    }
  }
}
