import { ChangeDetectionStrategy, Component, inject, Signal } from '@angular/core';
import {
  FileConflict,
  FileConflicts,
} from '@shared/angular/services/file-conflicts/file-conflicts';
import { Button } from '@shared/angular/components/forms/button/button';
import { Modal } from '@shared/angular/components/modal/modal';
import { ModalContent } from '@shared/angular/components/modal/modal-content';

/**
 * A tab-scoped keep/reload prompt shown when the file behind the active tab's document changed on
 * disk while it had unsaved edits. It renders only when the **active** tab has a pending conflict;
 * conflicts on inactive tabs are signalled by the tab's attention dot instead, so switching to a tab
 * is what raises its prompt.
 *
 * Presented in its own window like every other modal. It drew a hand-rolled overlay until #458 — an
 * absolutely positioned backdrop and card inside the page, the presentation `79c16089` removed
 * everywhere else — and was the last component doing so. That mattered beyond tidiness: it is named
 * `*-modal`, it sits beside the real ones, and it was what the next person found when looking for an
 * example of how Studio does modals.
 *
 * Deliberately **not dismissable**. The other two answers destroy something — your edits, or the
 * agreement between the buffer and the file — so there is no third answer that means "neither", and a
 * modal that could be waved away would leave the document in a state nothing later resolves.
 */
@Component({
  selector: 'app-document-conflict-modal',
  imports: [Modal, ModalContent, Button],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (conflict(); as current) {
      <app-modal [open]="true" [dismissable]="false" [width]="28" ariaLabel="File changed on disk">
        <ng-template appModalContent>
          <div class="conflict">
            <h2 class="conflict__title">File Changed on Disk</h2>
            <p class="conflict__body">
              <strong>{{ current.name }}</strong> was changed outside the editor, but you have
              unsaved changes. Keep your version, or reload the version on disk (discarding your
              edits)?
            </p>
            <div class="conflict__actions">
              <app-button label="Keep my version" (click)="keep(current)" />
              <app-button
                variant="solid"
                tone="danger"
                label="Reload from disk"
                (click)="reload(current)"
              />
            </div>
          </div>
        </ng-template>
      </app-modal>
    }
  `,
  styles: [
    `
      .conflict {
        display: flex;
        flex-direction: column;
        gap: 0.9rem;
      }

      .conflict__title {
        margin: 0;
        font-size: 1.05rem;
      }

      .conflict__body {
        margin: 0;
        line-height: 1.5;
      }

      .conflict__actions {
        display: flex;
        justify-content: flex-end;
        gap: 0.6rem;
        margin-block-start: 0.4rem;
      }
    `,
  ],
})
export class DocumentConflictModal {
  /**
   * Holds the conflict registry.
   */
  private readonly conflicts: FileConflicts = inject(FileConflicts);

  /**
   * Gets the conflict to prompt for on the active tab, or null when there is none.
   */
  public readonly conflict: Signal<FileConflict | null> = this.conflicts.activeConflict;

  /**
   * Keeps the user's in-editor version.
   * @param conflict The conflict being resolved.
   */
  public keep(conflict: FileConflict): void {
    this.conflicts.keep(conflict.documentId);
  }

  /**
   * Reloads the document from disk, discarding unsaved edits.
   * @param conflict The conflict being resolved.
   */
  public reload(conflict: FileConflict): void {
    this.conflicts.reload(conflict.documentId);
  }
}
