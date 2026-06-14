import { computed, Service, signal, Signal, WritableSignal } from '@angular/core';

/**
 * Defines the editor commands the code ribbon can invoke on the active code editor.
 */
export interface CodeCommandHandler {
  /**
   * Cuts the current selection to the clipboard.
   */
  cut(): void;

  /**
   * Copies the current selection to the clipboard.
   */
  copy(): void;

  /**
   * Pastes the clipboard contents at the cursor.
   */
  paste(): void;

  /**
   * Undoes the last edit.
   */
  undo(): void;

  /**
   * Redoes the last undone edit.
   */
  redo(): void;

  /**
   * Opens the editor's find widget.
   */
  find(): void;

  /**
   * Formats the whole document.
   */
  formatDocument(): void;

  /**
   * Saves the document, prompting for a path when it has never been saved.
   */
  save(): void;

  /**
   * Saves the document to a newly chosen path.
   */
  saveAs(): void;

  /**
   * Gets the editor's full text.
   * @returns Returns the document text.
   */
  getText(): string;

  /**
   * Replaces the editor's full text (as a single undoable edit).
   * @param text The new text.
   */
  replaceText(text: string): void;
}

/**
 * Routes code ribbon editor commands to the active code editor.
 *
 * The active {@link CodeView} registers its handler here; the ribbon controls call the matching
 * method, which forwards to the registered handler (or does nothing when no code editor is active).
 * File-level actions (open, save, save-as) are handled separately by the documents service, since
 * they are not tied to a live editor instance.
 */
@Service()
export class CodeCommands {
  /**
   * Holds the active editor's command handler, or null when no code editor is active.
   */
  private readonly handler: WritableSignal<CodeCommandHandler | null> =
    signal<CodeCommandHandler | null>(null);

  /**
   * Holds the most recently registered handler, retained across deactivation so the agent can act on
   * the last code editor the user worked in even when focus has moved to the agent. Cleared only when
   * that editor is disposed (via {@link forget}).
   */
  private lastHandler: CodeCommandHandler | null = null;

  /**
   * Gets a value indicating whether a code editor is currently active.
   */
  public readonly hasActiveEditor: Signal<boolean> = computed(
    (): boolean => this.handler() !== null,
  );

  /**
   * Registers the active editor's command handler.
   * @param handler The handler to register.
   */
  public register(handler: CodeCommandHandler): void {
    this.handler.set(handler);
    this.lastHandler = handler;
  }

  /**
   * Unregisters the given command handler, if it is the currently registered one. The handler is
   * retained as the agent target ({@link lastHandler}) until the editor is disposed.
   * @param handler The handler to unregister.
   */
  public unregister(handler: CodeCommandHandler): void {
    if (this.handler() === handler) {
      this.handler.set(null);
    }
  }

  /**
   * Forgets a handler entirely (its editor was disposed), clearing it as both the active and the
   * agent target.
   * @param handler The handler to forget.
   */
  public forget(handler: CodeCommandHandler): void {
    this.unregister(handler);
    if (this.lastHandler === handler) {
      this.lastHandler = null;
    }
  }

  /**
   * Reads the full text of the editor the agent should act on (the active editor, or the last one the
   * user worked in).
   * @returns Returns the text, or null when no code editor is available.
   */
  public readActiveText(): string | null {
    return this.aiTarget()?.getText() ?? null;
  }

  /**
   * Replaces the full text of the editor the agent should act on.
   * @param text The new text.
   * @returns Returns true when an editor was available and updated.
   */
  public replaceActiveText(text: string): boolean {
    const target: CodeCommandHandler | null = this.aiTarget();
    if (target === null) {
      return false;
    }
    target.replaceText(text);
    return true;
  }

  /**
   * Resolves the handler the agent should act on: the active editor, falling back to the last editor
   * the user worked in.
   * @returns Returns the target handler, or null when none is available.
   */
  private aiTarget(): CodeCommandHandler | null {
    return this.handler() ?? this.lastHandler;
  }

  /**
   * Invokes the cut command on the active editor.
   */
  public cut(): void {
    this.handler()?.cut();
  }

  /**
   * Invokes the copy command on the active editor.
   */
  public copy(): void {
    this.handler()?.copy();
  }

  /**
   * Invokes the paste command on the active editor.
   */
  public paste(): void {
    this.handler()?.paste();
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
   * Invokes the find command on the active editor.
   */
  public find(): void {
    this.handler()?.find();
  }

  /**
   * Invokes the format-document command on the active editor.
   */
  public formatDocument(): void {
    this.handler()?.formatDocument();
  }

  /**
   * Saves the active editor's document through its own (workspace-scoped) documents service, so the
   * focused well document is saved regardless of which ribbon is showing.
   */
  public save(): void {
    this.handler()?.save();
  }

  /**
   * Saves the active editor's document to a newly chosen path.
   */
  public saveAs(): void {
    this.handler()?.saveAs();
  }
}
