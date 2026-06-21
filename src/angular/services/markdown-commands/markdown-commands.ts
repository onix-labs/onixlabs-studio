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
   * Sets the block type (paragraph, heading, blockquote, code block) of the current block.
   * @param blockType The block type to apply.
   */
  setBlockType(blockType: MarkdownBlockType): void;
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
   * Registers the active markdown editor's command handler, resetting the tracked block type.
   * @param handler The handler to register.
   */
  public register(handler: MarkdownCommandHandler): void {
    this.handler.set(handler);
    this.activeBlockTypeSignal.set(DEFAULT_BLOCK_TYPE);
  }

  /**
   * Unregisters the given command handler, if it is the currently registered one.
   * @param handler The handler to unregister.
   */
  public unregister(handler: MarkdownCommandHandler): void {
    if (this.handler() === handler) {
      this.handler.set(null);
      this.activeBlockTypeSignal.set(DEFAULT_BLOCK_TYPE);
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
   * Invokes the set block type command on the active editor.
   * @param blockType The block type to apply.
   */
  public setBlockType(blockType: MarkdownBlockType): void {
    this.handler()?.setBlockType(blockType);
  }
}
