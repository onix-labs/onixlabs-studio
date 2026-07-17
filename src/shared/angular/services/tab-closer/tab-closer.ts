import { inject, Service } from '@angular/core';
import type { SaveDialogChoice } from '@shared/api/file-channels';
import { FileSystem } from '@shared/angular/services/file-system/file-system';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import { UnsavedWorkRegistry } from '@shared/angular/services/unsaved-work/unsaved-work-registry';

/**
 * Closes tabs with a consistent unsaved-changes guard, whichever document model backs the tab.
 *
 * Every document store contributes to the unsaved-work seam, so closing a tab walks the
 * contributions: a source holding unsaved changes for the tab prompts save / don't save / cancel
 * (the native dialog), a cancelled prompt — or a cancelled save-as — keeps the tab open, and once
 * resolved every source releases its document for the tab before the tab is removed. Tabs no source
 * knows (terminals, settings) close without a prompt. This mirrors the window-close flow the
 * Lifecycle service runs over the same seam.
 */
@Service()
export class TabCloser {
  /**
   * Holds the registry of unsaved-work sources (the static text/binary documents plus any view-scoped
   * workspace document wells), walked when a tab closes.
   */
  private readonly registry: UnsavedWorkRegistry = inject(UnsavedWorkRegistry);

  /**
   * Holds the file-system service showing the native confirm-save dialog.
   */
  private readonly fileSystem: FileSystem = inject(FileSystem);

  /**
   * Holds the tab registry the tab is removed from.
   */
  private readonly tabs: Tabs = inject(Tabs);

  /**
   * Closes a tab, resolving unsaved changes first.
   * @param id The tab identifier.
   * @returns Returns a promise that resolves once the close has been resolved either way.
   */
  public async close(id: string): Promise<void> {
    // Prompt for every document the closing tab hosts — a standalone editor/binary tab owns one, a
    // workspace tab owns every dirty document in its well — one modal at a time, saving each by its
    // own id (a well document's id is not the tab's).
    for (const source of this.registry.sources()) {
      for (const unsaved of source.dirtyDocumentsFor(id)) {
        const choice: SaveDialogChoice = await this.fileSystem.confirmSave(unsaved.name);
        if (choice === 'cancel') {
          return;
        }
        if (choice === 'save' && !(await source.save(unsaved.id))) {
          // The user cancelled the save-as dialog; keep the tab open so the work is not lost.
          return;
        }
      }
    }
    for (const source of this.registry.sources()) {
      source.release(id);
    }
    this.tabs.close(id);
  }
}
