import { computed, Service, Signal, signal, WritableSignal } from '@angular/core';

/**
 * Defines the document commands the directory (workspace) ribbon's File group can invoke on the
 * active workspace's document well.
 */
export interface WorkspaceDocumentCommandHandler {
  /**
   * Gets whether there is a document in the well to save, so the ribbon can disable Save when the
   * well is empty.
   */
  readonly canSave: Signal<boolean>;

  /**
   * Gets whether the well holds any unsaved changes, so the ribbon can disable Save All when there is
   * nothing to write.
   */
  readonly hasUnsavedChanges: Signal<boolean>;

  /**
   * Saves the well's active document, prompting for a path when it has never been saved.
   */
  save(): void;

  /**
   * Saves every document in the well that has unsaved changes.
   */
  saveAll(): void;
}

/**
 * Routes the directory ribbon's document commands to the active workspace's document well.
 *
 * A workspace tab's well is backed by a per-view
 * {@link import('@shared/angular/services/documents/documents').Documents} instance, which the ribbon
 * — rendered by the shell, outside any view's injector — cannot resolve. The active directory view
 * registers its handler here instead and the ribbon's Save and Save All forward through it (or do
 * nothing when no directory tab is active). This is the twin of the workspace find and source-control
 * command seams.
 */
@Service()
export class WorkspaceDocumentCommands {
  /**
   * Holds the active workspace's command handler, or null when no directory tab is active.
   */
  private readonly handler: WritableSignal<WorkspaceDocumentCommandHandler | null> =
    signal<WorkspaceDocumentCommandHandler | null>(null);

  /**
   * Gets whether the active workspace has a document to save.
   */
  public readonly canSave: Signal<boolean> = computed(
    (): boolean => this.handler()?.canSave() ?? false,
  );

  /**
   * Gets whether the active workspace's well holds unsaved changes.
   */
  public readonly hasUnsavedChanges: Signal<boolean> = computed(
    (): boolean => this.handler()?.hasUnsavedChanges() ?? false,
  );

  /**
   * Registers the active workspace's command handler.
   * @param handler The handler to register.
   */
  public register(handler: WorkspaceDocumentCommandHandler): void {
    this.handler.set(handler);
  }

  /**
   * Unregisters the given command handler, if it is the currently registered one.
   * @param handler The handler to unregister.
   */
  public unregister(handler: WorkspaceDocumentCommandHandler): void {
    if (this.handler() === handler) {
      this.handler.set(null);
    }
  }

  /**
   * Saves the active workspace's active well document.
   */
  public save(): void {
    this.handler()?.save();
  }

  /**
   * Saves every document with unsaved changes in the active workspace's well.
   */
  public saveAll(): void {
    this.handler()?.saveAll();
  }
}
