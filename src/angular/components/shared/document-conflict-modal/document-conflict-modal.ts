import { ChangeDetectionStrategy, Component, inject, Signal } from '@angular/core';
import { FileConflict, FileConflicts } from '../../../services/file-conflicts/file-conflicts';

/**
 * A tab-scoped keep/reload prompt shown when the file behind the active tab's document changed on
 * disk while it had unsaved edits. Mounted once over the tab content area; it renders only when the
 * active tab has a pending conflict (conflicts on inactive tabs are signalled by the tab's attention
 * dot instead).
 */
@Component({
  selector: 'app-document-conflict-modal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (conflict(); as current) {
      <div class="overlay" role="presentation">
        <div class="card" role="alertdialog" aria-labelledby="conflict-title">
          <h2 class="title" id="conflict-title">File changed on disk</h2>
          <p class="body">
            <strong>{{ current.name }}</strong> was changed outside the editor, but you have unsaved
            changes. Keep your version, or reload the version on disk (discarding your edits)?
          </p>
          <div class="actions">
            <button type="button" class="btn" (click)="keep(current)">Keep my version</button>
            <button type="button" class="btn btn--danger" (click)="reload(current)">
              Reload from disk
            </button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [
    `
      .overlay {
        position: absolute;
        inset: 0;
        z-index: 50;
        display: grid;
        place-items: center;
        padding: 1.5rem;
        background: rgba(0, 0, 0, 0.45);
      }

      .card {
        max-inline-size: 26rem;
        padding: 1.25rem 1.4rem;
        color: var(--body-foreground-color);
        background: var(--body-background-color);
        border: 0.0625rem solid var(--dock-border-color);
        border-radius: 0.75rem;
        corner-shape: squircle;
        box-shadow: 0 1rem 3rem rgba(0, 0, 0, 0.4);
      }

      .title {
        margin: 0 0 0.6rem;
        font-size: 1.05rem;
      }

      .body {
        margin: 0 0 1.1rem;
        line-height: 1.5;
      }

      .actions {
        display: flex;
        justify-content: flex-end;
        gap: 0.6rem;
      }

      .btn {
        padding: 0.45rem 1rem;
        font: inherit;
        color: var(--body-foreground-color);
        background: transparent;
        border: 0.0625rem solid var(--dock-border-color);
        border-radius: 0.5rem;
        corner-shape: squircle;
        cursor: pointer;
      }

      .btn--danger {
        color: var(--gray-100);
        background: var(--accent-color);
        border-color: var(--accent-color);
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
