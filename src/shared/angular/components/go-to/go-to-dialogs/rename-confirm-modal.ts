import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { Modal } from '@shared/angular/components/modal/modal';
import { ModalContent } from '@shared/angular/components/modal/modal-content';
import { Button } from '@shared/angular/components/forms/button/button';
import { ButtonRow } from '@shared/angular/components/forms/button-row/button-row';
import { ListRow, ListView } from '@shared/angular/components/list-view/list-view';
import {
  RenameConfirmation,
  RenameConfirmationFile,
  RenameConfirmationRequest,
} from '@shared/angular/services/rename/rename-confirmation';

/**
 * The confirmation a rename across several files asks before anything changes (#1015): what the
 * symbol is renamed to, and each file it changes — with how many places, and whether the file is open
 * (changed in its editor, unsaved) or closed (changed on disk). Rename goes ahead; Cancel, Escape or
 * the window's close button changes nothing. Shown whichever Go to style is chosen: it is a decision
 * over a list, which only a dialog has room for. A code action's change across several files (#1016)
 * is confirmed here too, asking its own question with its own button.
 */
@Component({
  selector: 'app-rename-confirm-modal',
  imports: [Modal, ModalContent, Button, ButtonRow, ListView],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './go-to-dialog.scss',
  template: `
    @if (confirmation.pending(); as request) {
      <app-modal
        [open]="true"
        [width]="34"
        [ariaLabel]="request.title === undefined ? 'Rename Symbol' : request.title"
        (dismiss)="confirmation.answer(false)"
      >
        <ng-template appModalContent>
          <div class="go-to-dialog">
            <h2 class="go-to-dialog__title">{{ heading() }}</h2>
            <p class="go-to-dialog__summary">{{ summary() }}</p>
            <app-list-view class="go-to-dialog__list go-to-dialog__list--files" [rows]="rows()">
              <ng-template let-row>
                @let file = fileOf(row);
                <span class="go-to-dialog__name">{{ file.name }}</span>
                <span class="go-to-dialog__container">{{ file.folder }}</span>
                <span class="go-to-dialog__count">
                  {{ file.edits === 1 ? '1 change' : file.edits + ' changes'
                  }}{{ file.open ? ' · open, unsaved' : '' }}
                </span>
              </ng-template>
            </app-list-view>
            <app-button-row class="go-to-dialog__actions">
              <app-button
                variant="solid"
                [label]="request.confirmLabel ?? 'Rename'"
                (click)="confirmation.answer(true)"
              />
              <app-button label="Cancel" (click)="confirmation.answer(false)" />
            </app-button-row>
          </div>
        </ng-template>
      </app-modal>
    }
  `,
})
export class RenameConfirmModal {
  /**
   * Holds the confirmation whose open request this dialog shows.
   */
  protected readonly confirmation: RenameConfirmation = inject(RenameConfirmation);

  /**
   * Gets the files as list rows, each carrying its file.
   */
  protected readonly rows: Signal<readonly ListRow[]> = computed((): readonly ListRow[] =>
    (this.confirmation.pending()?.files ?? []).map((file: RenameConfirmationFile): ListRow => ({
      id: file.path,
      data: file,
    })),
  );

  /**
   * Gets the question the dialog asks: the request's own, or a rename's.
   */
  protected readonly heading: Signal<string> = computed((): string => {
    const request: RenameConfirmationRequest | null = this.confirmation.pending();
    if (request === null) {
      return '';
    }
    return request.title ?? `Rename “${request.oldName}” to “${request.newName}”?`;
  });

  /**
   * Gets the line under the title: how many places change in how many files, and where.
   */
  protected readonly summary: Signal<string> = computed((): string => {
    const request: RenameConfirmationRequest | null = this.confirmation.pending();
    if (request === null) {
      return '';
    }
    const places: number = request.files.reduce(
      (sum: number, file: RenameConfirmationFile): number => sum + file.edits,
      0,
    );
    const open: boolean = request.files.some((file: RenameConfirmationFile): boolean => file.open);
    const closed: boolean = request.files.some(
      (file: RenameConfirmationFile): boolean => !file.open,
    );
    const where: string =
      open && closed
        ? ' Open files change in their editors, unsaved; the rest change on disk.'
        : open
          ? ' They change in their editors, unsaved.'
          : ' They change on disk.';
    return `${places} changes in ${request.files.length} files.${where}`;
  });

  /**
   * Reads a row's file, for the row template.
   * @param row The row.
   * @returns Returns the file it carries.
   */
  protected fileOf(row: ListRow): RenameConfirmationFile {
    return row.data as RenameConfirmationFile;
  }
}
