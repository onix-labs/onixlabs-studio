import { inject, Service } from '@angular/core';
import type { AppApi, SaveDialogChoice } from '../../../shared/studio-api';
import { Documents } from '../documents/documents';
import { FileSystem } from '../file-system/file-system';

/**
 * Answers the main process's request to close the window. When the window is closing, it walks the
 * documents with unsaved changes and prompts to save, discard, or cancel each one (reusing the native
 * confirm-save dialog), then tells the main process whether to proceed. Cancelling any prompt — or a
 * cancelled save-as — keeps the window open. Outside Electron the bridge is absent and the service is
 * inert.
 */
@Service()
export class Lifecycle {
  /**
   * Holds the application-lifecycle bridge, or undefined when running outside Electron.
   */
  private readonly api: AppApi | undefined = window.studio?.app;

  /**
   * Holds the documents service tracking unsaved changes.
   */
  private readonly documents: Documents = inject(Documents);

  /**
   * Holds the file-system service used to prompt for saving.
   */
  private readonly fileSystem: FileSystem = inject(FileSystem);

  /**
   * Initializes a new instance of the {@link Lifecycle} class, subscribing to close requests.
   */
  public constructor() {
    this.api?.onRequestClose((): void => {
      void this.onRequestClose();
    });
  }

  /**
   * Handles a close request: resolves any unsaved work, then answers the main process.
   * @returns Returns a promise that resolves once the decision has been sent.
   */
  private async onRequestClose(): Promise<void> {
    const proceed: boolean = await this.confirmUnsavedChanges();
    this.api?.respondClose(proceed);
  }

  /**
   * Prompts for each document with unsaved changes in turn, saving or discarding per the user's
   * choice. Prompts are shown one at a time because each is a modal dialog.
   * @returns Returns true when the window may close, or false when the user cancelled.
   */
  private async confirmUnsavedChanges(): Promise<boolean> {
    // Prompts are awaited one at a time: each is a modal dialog, and the save follows its own prompt.
    for (const unsaved of this.documents.dirtyDocuments()) {
      const choice: SaveDialogChoice = await this.fileSystem.confirmSave(unsaved.name);
      if (choice === 'cancel') {
        return false;
      }
      if (choice === 'save' && !(await this.documents.save(unsaved.id))) {
        // The user cancelled the save-as dialog; abort the close so the work is not lost.
        return false;
      }
    }
    return true;
  }
}
