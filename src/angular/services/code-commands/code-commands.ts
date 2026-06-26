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
 * Routes code ribbon editor commands to the active code editor, and gives the agent per-tab access to
 * each editor.
 *
 * Each {@link CodeView} registers its handler under its tab id; the ribbon controls forward to the
 * active tab's handler, while the agent — which is docked to a specific tab — acts on that tab's
 * handler by id. Handlers are retained until their editor is disposed, so an agent in a backgrounded
 * tab still reaches its editor. File-level actions (open) are handled separately by the documents
 * service, since they are not tied to a live editor instance.
 */
@Service()
export class CodeCommands {
  /**
   * Holds every live editor's command handler, keyed by tab id.
   */
  private readonly handlers: Map<string, CodeCommandHandler> = new Map<
    string,
    CodeCommandHandler
  >();

  /**
   * Holds the id of the active editor's tab, or null when no code editor is active.
   */
  private readonly activeId: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Holds the id of the most recently active editor, retained across deactivation so the agent (when
   * not scoped to a specific tab) can act on the last code editor the user worked in.
   */
  private lastActiveId: string | null = null;

  /**
   * Gets a value indicating whether a code editor is currently active.
   */
  public readonly hasActiveEditor: Signal<boolean> = computed(
    (): boolean => this.activeHandler() !== null,
  );

  /**
   * Registers an editor's command handler under its tab id, marking it the active editor.
   * @param id The owning tab identifier.
   * @param handler The handler to register.
   */
  public register(id: string, handler: CodeCommandHandler): void {
    this.handlers.set(id, handler);
    this.activeId.set(id);
    this.lastActiveId = id;
  }

  /**
   * Marks a tab's editor inactive (it lost focus), while keeping its handler registered so the agent
   * can still act on it.
   * @param id The owning tab identifier.
   */
  public deactivate(id: string): void {
    if (this.activeId() === id) {
      this.activeId.set(null);
    }
  }

  /**
   * Forgets a tab's editor entirely (its editor was disposed), clearing it as the active, last and
   * agent target.
   * @param id The owning tab identifier.
   */
  public forget(id: string): void {
    this.handlers.delete(id);
    if (this.activeId() === id) {
      this.activeId.set(null);
    }
    if (this.lastActiveId === id) {
      this.lastActiveId = null;
    }
  }

  /**
   * Reads the full text of a specific tab's editor.
   * @param id The owning tab identifier.
   * @returns Returns the text, or null when no editor is registered for the tab.
   */
  public readText(id: string): string | null {
    return this.handlers.get(id)?.getText() ?? null;
  }

  /**
   * Replaces the full text of a specific tab's editor.
   * @param id The owning tab identifier.
   * @param text The new text.
   * @returns Returns true when an editor was registered for the tab and updated.
   */
  public replaceText(id: string, text: string): boolean {
    const handler: CodeCommandHandler | undefined = this.handlers.get(id);
    if (handler === undefined) {
      return false;
    }
    handler.replaceText(text);
    return true;
  }

  /**
   * Reads the full text of the editor the unscoped agent should act on (the active editor, or the last
   * one the user worked in). Used when a run carries no owning tab.
   * @returns Returns the text, or null when no code editor is available.
   */
  public readActiveText(): string | null {
    return this.fallbackTarget()?.getText() ?? null;
  }

  /**
   * Replaces the full text of the editor the unscoped agent should act on.
   * @param text The new text.
   * @returns Returns true when an editor was available and updated.
   */
  public replaceActiveText(text: string): boolean {
    const target: CodeCommandHandler | null = this.fallbackTarget();
    if (target === null) {
      return false;
    }
    target.replaceText(text);
    return true;
  }

  /**
   * Resolves the active editor's handler (for ribbon commands).
   * @returns Returns the active handler, or null when none is active.
   */
  private activeHandler(): CodeCommandHandler | null {
    const id: string | null = this.activeId();
    return id === null ? null : (this.handlers.get(id) ?? null);
  }

  /**
   * Resolves the handler the unscoped agent should act on: the active editor, falling back to the last
   * editor the user worked in.
   * @returns Returns the target handler, or null when none is available.
   */
  private fallbackTarget(): CodeCommandHandler | null {
    const id: string | null = this.activeId() ?? this.lastActiveId;
    return id === null ? null : (this.handlers.get(id) ?? null);
  }

  /**
   * Invokes the cut command on the active editor.
   */
  public cut(): void {
    this.activeHandler()?.cut();
  }

  /**
   * Invokes the copy command on the active editor.
   */
  public copy(): void {
    this.activeHandler()?.copy();
  }

  /**
   * Invokes the paste command on the active editor.
   */
  public paste(): void {
    this.activeHandler()?.paste();
  }

  /**
   * Invokes the undo command on the active editor.
   */
  public undo(): void {
    this.activeHandler()?.undo();
  }

  /**
   * Invokes the redo command on the active editor.
   */
  public redo(): void {
    this.activeHandler()?.redo();
  }

  /**
   * Invokes the find command on the active editor.
   */
  public find(): void {
    this.activeHandler()?.find();
  }

  /**
   * Invokes the format-document command on the active editor.
   */
  public formatDocument(): void {
    this.activeHandler()?.formatDocument();
  }

  /**
   * Saves the active editor's document through its own (workspace-scoped) documents service, so the
   * focused well document is saved regardless of which ribbon is showing.
   */
  public save(): void {
    this.activeHandler()?.save();
  }

  /**
   * Saves the active editor's document to a newly chosen path.
   */
  public saveAs(): void {
    this.activeHandler()?.saveAs();
  }
}
