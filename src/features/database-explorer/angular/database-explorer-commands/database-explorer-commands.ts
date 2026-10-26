import { computed, Service, Signal, signal, WritableSignal } from '@angular/core';

/**
 * The contract the active Database Explorer view implements so the ribbon can drive it — the same
 * command-registry pattern as the API Explorer's: the ribbon is rendered by the shell, outside the
 * view's injector, so the view registers a handler while it is alive.
 */
export interface DatabaseExplorerCommandHandler {
  /**
   * Gets whether the query open in the well can run.
   */
  readonly canExecute: Signal<boolean>;

  /**
   * Gets whether the query open in the well is running.
   */
  readonly executing: Signal<boolean>;

  /**
   * Gets whether the document has a passphrase.
   */
  readonly hasPassphrase: Signal<boolean>;

  /**
   * Gets whether the document's passphrase is still to be given this session.
   */
  readonly locked: Signal<boolean>;

  /**
   * Runs the open query (its selection, or all of it), or cancels it when it is running.
   */
  execute(): void;

  /**
   * Opens a new query against the selected connection.
   */
  newQuery(): void;

  /**
   * Opens the dialog for a new connection.
   */
  newConnection(): void;

  /**
   * Saves the document.
   */
  saveDocument(): void;

  /**
   * Saves the document to a newly chosen file.
   */
  saveDocumentAs(): void;

  /**
   * Restores the tab's default arrangement, keeping its open queries.
   */
  resetLayout(): void;
  /**
   * Asks for a passphrase to give the document, or a new one.
   */
  setPassphrase(): void;

  /**
   * Removes the document's passphrase.
   */
  removePassphrase(): void;

  /**
   * Asks for the passphrase of a document that is still locked.
   */
  unlockPassphrase(): void;
}

/**
 * The registry the Database Explorer ribbon calls into.
 */
@Service()
export class DatabaseExplorerCommands {
  private readonly handler: WritableSignal<DatabaseExplorerCommandHandler | null> =
    signal<DatabaseExplorerCommandHandler | null>(null);

  /**
   * Gets whether the active view's open query can run.
   */
  public readonly canExecute: Signal<boolean> = computed(
    (): boolean => this.handler()?.canExecute() ?? false,
  );

  /**
   * Gets whether the active view's open query is running.
   */
  public readonly executing: Signal<boolean> = computed(
    (): boolean => this.handler()?.executing() ?? false,
  );

  /**
   * Gets whether the active document has a passphrase.
   */
  public readonly hasPassphrase: Signal<boolean> = computed(
    (): boolean => this.handler()?.hasPassphrase() ?? false,
  );

  /**
   * Gets whether the active document's passphrase is still to be given.
   */
  public readonly locked: Signal<boolean> = computed(
    (): boolean => this.handler()?.locked() ?? false,
  );

  /**
   * Registers the active view's handler.
   * @param handler The handler.
   */
  public register(handler: DatabaseExplorerCommandHandler): void {
    this.handler.set(handler);
  }

  /**
   * Clears a handler when its view is destroyed, ignoring a stale clear.
   * @param handler The handler.
   */
  public clear(handler: DatabaseExplorerCommandHandler): void {
    if (this.handler() === handler) {
      this.handler.set(null);
    }
  }

  /**
   * Runs or cancels the open query.
   */
  public execute(): void {
    this.handler()?.execute();
  }

  /**
   * Opens a new query.
   */
  public newQuery(): void {
    this.handler()?.newQuery();
  }

  /**
   * Opens the new-connection dialog.
   */
  public newConnection(): void {
    this.handler()?.newConnection();
  }

  /**
   * Saves the document.
   */
  public saveDocument(): void {
    this.handler()?.saveDocument();
  }

  /**
   * Saves the document to a newly chosen file.
   */
  public saveDocumentAs(): void {
    this.handler()?.saveDocumentAs();
  }

  /**
   * Restores the tab's default arrangement, keeping its open queries.
   */
  public resetLayout(): void {
    this.handler()?.resetLayout();
  }
  /**
   * Asks for a passphrase to give the document, or a new one.
   */
  public setPassphrase(): void {
    this.handler()?.setPassphrase();
  }

  /**
   * Removes the document's passphrase.
   */
  public removePassphrase(): void {
    this.handler()?.removePassphrase();
  }

  /**
   * Asks for the passphrase of a document that is still locked.
   */
  public unlockPassphrase(): void {
    this.handler()?.unlockPassphrase();
  }
}
