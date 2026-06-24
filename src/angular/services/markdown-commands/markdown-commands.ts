import { computed, Service, signal, Signal, WritableSignal } from '@angular/core';

/**
 * Identifies the block type at the markdown editor's current selection. Drives the ribbon's block
 * style field and the {@link MarkdownCommandHandler.setBlockType} command.
 */
export type MarkdownBlockType =
  | 'paragraph'
  | 'blockquote'
  | 'code-block'
  | 'heading-1'
  | 'heading-2'
  | 'heading-3'
  | 'heading-4'
  | 'heading-5'
  | 'heading-6'
  | 'alert-note'
  | 'alert-tip'
  | 'alert-important'
  | 'alert-caution'
  | 'alert-warning';

/**
 * Holds the block type assumed when no editor is active or the selection is plain text.
 */
const DEFAULT_BLOCK_TYPE: MarkdownBlockType = 'paragraph';

/**
 * Describes a heading in the document outline, including its level, text, and the editor position to
 * navigate to. Both ATX (`#`) and setext (underlined) headings are represented uniformly.
 */
export interface OutlineHeading {
  /**
   * Gets a stable identifier for the heading (derived from its document position).
   */
  readonly id: string;

  /**
   * Gets the heading level, from 1 to 6.
   */
  readonly level: number;

  /**
   * Gets the heading's text.
   */
  readonly text: string;

  /**
   * Gets the editor document position the heading starts at, used to navigate to it.
   */
  readonly pos: number;
}

/**
 * Defines the formatting commands the markdown ribbon can invoke on the active markdown editor.
 */
export interface MarkdownCommandHandler {
  /**
   * Cuts the current selection to the clipboard as markdown, preserving its formatting.
   */
  cut(): void;

  /**
   * Cuts the current selection to the clipboard as unformatted plain text.
   */
  cutAsPlaintext(): void;

  /**
   * Copies the current selection to the clipboard as markdown, preserving its formatting.
   */
  copy(): void;

  /**
   * Copies the current selection to the clipboard as unformatted plain text.
   */
  copyAsPlaintext(): void;

  /**
   * Pastes the clipboard contents at the selection, parsing them as markdown.
   */
  paste(): void;

  /**
   * Pastes the clipboard contents at the selection as unformatted plain text.
   */
  pasteAsPlaintext(): void;

  /**
   * Pastes the clipboard contents at the selection as a code block.
   */
  pasteAsCode(): void;

  /**
   * Undoes the last edit.
   */
  undo(): void;

  /**
   * Redoes the last undone edit.
   */
  redo(): void;

  /**
   * Toggles bold (strong) formatting on the selection.
   */
  toggleBold(): void;

  /**
   * Toggles italic (emphasis) formatting on the selection.
   */
  toggleItalic(): void;

  /**
   * Toggles strikethrough formatting on the selection.
   */
  toggleStrikethrough(): void;

  /**
   * Toggles inline code formatting on the selection.
   */
  toggleInlineCode(): void;

  /**
   * Wraps the current block(s) in a bullet (unordered) list.
   */
  toggleBulletList(): void;

  /**
   * Wraps the current block(s) in an ordered (numbered) list.
   */
  toggleOrderedList(): void;

  /**
   * Inserts a table at the cursor.
   */
  insertTable(): void;

  /**
   * Inserts a horizontal rule (thematic break) at the cursor.
   */
  insertHorizontalRule(): void;

  /**
   * Inserts parsed markdown as block-level content at the cursor, replacing any selection.
   * @param markdown The markdown to parse and insert (for example an image, code fence, or HTML block).
   */
  insertMarkdown(markdown: string): void;

  /**
   * Inserts parsed markdown as inline content at the cursor, replacing any selection. The markdown is
   * parsed and its inline content (such as a link or inline math) is spliced into the current block.
   * @param markdown The inline markdown to parse and insert.
   */
  insertInlineMarkdown(markdown: string): void;

  /**
   * Inserts raw text at the cursor, replacing any selection.
   * @param text The text to insert (for example a Unicode emoji).
   */
  insertText(text: string): void;

  /**
   * Appends parsed markdown as block-level content at the end of the document. Used for content that
   * lives apart from the cursor, such as a footnote definition.
   * @param markdown The markdown to parse and append.
   */
  appendMarkdown(markdown: string): void;

  /**
   * Sets the block type (paragraph, heading, blockquote, code block) of the current block.
   * @param blockType The block type to apply.
   */
  setBlockType(blockType: MarkdownBlockType): void;

  /**
   * Moves the selection to the heading at the given document position and scrolls it into view.
   * @param pos The heading's document position.
   */
  goToHeading(pos: number): void;
}

/**
 * Routes markdown ribbon commands to the active markdown editor and mirrors the cursor's block type
 * back to the ribbon.
 *
 * The active {@link MarkdownView} registers its handler here; the ribbon controls call the matching
 * method, which forwards to the registered handler (or does nothing when no markdown editor is
 * active). The view publishes the selection's block type through {@link setActiveBlockType} so the
 * ribbon's style field can follow the cursor.
 */
@Service()
export class MarkdownCommands {
  /**
   * Holds the active markdown editor's command handler, or null when no markdown editor is active.
   */
  private readonly handler: WritableSignal<MarkdownCommandHandler | null> =
    signal<MarkdownCommandHandler | null>(null);

  /**
   * Holds the block type at the active editor's current selection.
   */
  private readonly activeBlockTypeSignal: WritableSignal<MarkdownBlockType> =
    signal<MarkdownBlockType>(DEFAULT_BLOCK_TYPE);

  /**
   * Holds whether the active editor has an edit that can be undone.
   */
  private readonly canUndoSignal: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds whether the active editor has an undone edit that can be redone.
   */
  private readonly canRedoSignal: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds the active editor's document outline.
   */
  private readonly outlineSignal: WritableSignal<readonly OutlineHeading[]> = signal<
    readonly OutlineHeading[]
  >([]);

  /**
   * Gets a value indicating whether a markdown editor is currently active.
   */
  public readonly hasActiveEditor: Signal<boolean> = computed(
    (): boolean => this.handler() !== null,
  );

  /**
   * Gets the block type at the active editor's current selection.
   */
  public readonly activeBlockType: Signal<MarkdownBlockType> =
    this.activeBlockTypeSignal.asReadonly();

  /**
   * Gets a value indicating whether the active editor has an edit that can be undone.
   */
  public readonly canUndo: Signal<boolean> = this.canUndoSignal.asReadonly();

  /**
   * Gets a value indicating whether the active editor has an undone edit that can be redone.
   */
  public readonly canRedo: Signal<boolean> = this.canRedoSignal.asReadonly();

  /**
   * Gets the active editor's document outline (its headings), or an empty list when no editor is
   * active.
   */
  public readonly outline: Signal<readonly OutlineHeading[]> = this.outlineSignal.asReadonly();

  /**
   * Registers the active markdown editor's command handler, resetting the tracked block type.
   * @param handler The handler to register.
   */
  public register(handler: MarkdownCommandHandler): void {
    this.handler.set(handler);
    this.activeBlockTypeSignal.set(DEFAULT_BLOCK_TYPE);
    this.canUndoSignal.set(false);
    this.canRedoSignal.set(false);
    this.outlineSignal.set([]);
  }

  /**
   * Unregisters the given command handler, if it is the currently registered one.
   * @param handler The handler to unregister.
   */
  public unregister(handler: MarkdownCommandHandler): void {
    if (this.handler() === handler) {
      this.handler.set(null);
      this.activeBlockTypeSignal.set(DEFAULT_BLOCK_TYPE);
      this.canUndoSignal.set(false);
      this.canRedoSignal.set(false);
      this.outlineSignal.set([]);
    }
  }

  /**
   * Sets the block type at the active editor's current selection, so the ribbon can reflect the
   * cursor position.
   * @param blockType The block type at the current selection.
   */
  public setActiveBlockType(blockType: MarkdownBlockType): void {
    this.activeBlockTypeSignal.set(blockType);
  }

  /**
   * Sets whether the active editor currently has undoable and redoable edits, so the ribbon can
   * enable or disable its Undo and Redo controls.
   * @param canUndo Whether there is an edit that can be undone.
   * @param canRedo Whether there is an undone edit that can be redone.
   */
  public setHistoryState(canUndo: boolean, canRedo: boolean): void {
    this.canUndoSignal.set(canUndo);
    this.canRedoSignal.set(canRedo);
  }

  /**
   * Sets the active editor's document outline, so the Outline panel can reflect the headings.
   * @param outline The headings in document order.
   */
  public setOutline(outline: readonly OutlineHeading[]): void {
    this.outlineSignal.set(outline);
  }

  /**
   * Navigates the active editor to the heading at the given document position.
   * @param pos The heading's document position.
   */
  public goToHeading(pos: number): void {
    this.handler()?.goToHeading(pos);
  }

  /**
   * Invokes the cut command on the active editor, serialising the selection as markdown.
   */
  public cut(): void {
    this.handler()?.cut();
  }

  /**
   * Invokes the cut-as-plaintext command on the active editor.
   */
  public cutAsPlaintext(): void {
    this.handler()?.cutAsPlaintext();
  }

  /**
   * Invokes the copy command on the active editor, serialising the selection as markdown.
   */
  public copy(): void {
    this.handler()?.copy();
  }

  /**
   * Invokes the copy-as-plaintext command on the active editor.
   */
  public copyAsPlaintext(): void {
    this.handler()?.copyAsPlaintext();
  }

  /**
   * Invokes the paste command on the active editor, parsing the clipboard as markdown.
   */
  public paste(): void {
    this.handler()?.paste();
  }

  /**
   * Invokes the paste-as-plaintext command on the active editor.
   */
  public pasteAsPlaintext(): void {
    this.handler()?.pasteAsPlaintext();
  }

  /**
   * Invokes the paste-as-code command on the active editor.
   */
  public pasteAsCode(): void {
    this.handler()?.pasteAsCode();
  }

  /**
   * Invokes the undo command on the active editor.
   */
  public undo(): void {
    this.handler()?.undo();
  }

  /**
   * Invokes the redo command on the active editor.
   */
  public redo(): void {
    this.handler()?.redo();
  }

  /**
   * Invokes the toggle bold command on the active editor.
   */
  public toggleBold(): void {
    this.handler()?.toggleBold();
  }

  /**
   * Invokes the toggle italic command on the active editor.
   */
  public toggleItalic(): void {
    this.handler()?.toggleItalic();
  }

  /**
   * Invokes the toggle strikethrough command on the active editor.
   */
  public toggleStrikethrough(): void {
    this.handler()?.toggleStrikethrough();
  }

  /**
   * Invokes the toggle inline code command on the active editor.
   */
  public toggleInlineCode(): void {
    this.handler()?.toggleInlineCode();
  }

  /**
   * Invokes the bullet list command on the active editor.
   */
  public toggleBulletList(): void {
    this.handler()?.toggleBulletList();
  }

  /**
   * Invokes the ordered list command on the active editor.
   */
  public toggleOrderedList(): void {
    this.handler()?.toggleOrderedList();
  }

  /**
   * Invokes the insert table command on the active editor.
   */
  public insertTable(): void {
    this.handler()?.insertTable();
  }

  /**
   * Invokes the insert horizontal rule command on the active editor.
   */
  public insertHorizontalRule(): void {
    this.handler()?.insertHorizontalRule();
  }

  /**
   * Inserts parsed markdown as block-level content at the active editor's cursor.
   * @param markdown The markdown to parse and insert.
   */
  public insertMarkdown(markdown: string): void {
    this.handler()?.insertMarkdown(markdown);
  }

  /**
   * Inserts parsed markdown as inline content at the active editor's cursor.
   * @param markdown The inline markdown to parse and insert.
   */
  public insertInlineMarkdown(markdown: string): void {
    this.handler()?.insertInlineMarkdown(markdown);
  }

  /**
   * Inserts raw text at the active editor's cursor.
   * @param text The text to insert.
   */
  public insertText(text: string): void {
    this.handler()?.insertText(text);
  }

  /**
   * Appends parsed markdown as block-level content at the end of the active editor's document.
   * @param markdown The markdown to parse and append.
   */
  public appendMarkdown(markdown: string): void {
    this.handler()?.appendMarkdown(markdown);
  }

  /**
   * Invokes the set block type command on the active editor.
   * @param blockType The block type to apply.
   */
  public setBlockType(blockType: MarkdownBlockType): void {
    this.handler()?.setBlockType(blockType);
  }
}
