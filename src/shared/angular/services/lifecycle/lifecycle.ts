import { inject, Service } from '@angular/core';
import { AppChannel } from '@shared/api/app-channels';
import type { Bridge } from '@shared/api/bridge';
import type { SaveDialogChoice } from '@shared/api/file-channels';
import { FileSystem } from '@shared/angular/services/file-system/file-system';
import {
  UNSAVED_WORK,
  UnsavedWorkSource,
} from '@shared/angular/services/unsaved-work/unsaved-work';

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
   * Holds the generic transport, or undefined when running outside Electron.
   */
  private readonly bridge: Bridge | undefined = window.bridge;

  /**
   * Holds every contributed store of unsaved work (the text documents, each feature's own document
   * model), walked in contribution order at close time.
   */
  private readonly unsavedWork: readonly UnsavedWorkSource[] =
    inject(UNSAVED_WORK, { optional: true }) ?? [];

  /**
   * Holds the file-system service used to prompt for saving.
   */
  private readonly fileSystem: FileSystem = inject(FileSystem);

  /**
   * Initializes a new instance of the {@link Lifecycle} class, subscribing to close requests.
   */
  public constructor() {
    this.bridge?.on(AppChannel.RequestClose, (): void => {
      void this.onRequestClose();
    });
  }

  /**
   * Handles a close request: resolves any unsaved work, then answers the main process.
   * @returns Returns a promise that resolves once the decision has been sent.
   */
  private async onRequestClose(): Promise<void> {
    const proceed: boolean = await this.confirmUnsavedChanges();
    this.bridge?.send(AppChannel.ConfirmClose, proceed);
  }

  /**
   * Prompts for each document with unsaved changes in turn, saving or discarding per the user's
   * choice. Prompts are shown one at a time because each is a modal dialog.
   * @returns Returns true when the window may close, or false when the user cancelled.
   */
  private async confirmUnsavedChanges(): Promise<boolean> {
    // Prompts are awaited one at a time: each is a modal dialog, and the save follows its own prompt.
    for (const source of this.unsavedWork) {
      for (const unsaved of source.dirtyDocuments()) {
        const choice: SaveDialogChoice = await this.fileSystem.confirmSave(unsaved.name);
        if (choice === 'cancel') {
          return false;
        }
        if (choice === 'save' && !(await source.save(unsaved.id))) {
          // The user cancelled the save-as dialog; abort the close so the work is not lost.
          return false;
        }
      }
    }
    return true;
  }
}
