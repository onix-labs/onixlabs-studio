import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Modal } from '@shared/angular/components/modal/modal';
import { ModalContent } from '@shared/angular/components/modal/modal-content';
import { Button } from '@shared/angular/components/forms/button/button';
import { ButtonRow } from '@shared/angular/components/forms/button-row/button-row';
import { LineTerminatorsConfirmation } from '@shared/angular/services/line-terminators/line-terminators-confirmation';

/**
 * The question Studio asks when a document holds unusual line terminators (#1024), in place of the
 * browser's confirm box Monaco asked it in: Remove Them takes them out, as one edit an undo takes back;
 * Leave As Is, Escape or the window's close button leaves them, and the document is not asked about
 * again while it is open.
 */
@Component({
  selector: 'app-line-terminators-confirm-modal',
  imports: [Modal, ModalContent, Button, ButtonRow],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './go-to-dialog.scss',
  template: `
    @if (confirmation.pending(); as request) {
      <app-modal
        [open]="true"
        [width]="30"
        ariaLabel="Unusual line terminators"
        (dismiss)="confirmation.answer(false)"
      >
        <ng-template appModalContent>
          <div class="go-to-dialog">
            <h2 class="go-to-dialog__title">Remove unusual line terminators?</h2>
            <p class="go-to-dialog__summary">
              {{ request.document }} contains Line Separator or Paragraph Separator characters,
              which some tools treat as line breaks and others don't. Removing them is recommended.
            </p>
            <app-button-row class="go-to-dialog__actions">
              <app-button variant="solid" label="Remove Them" (click)="confirmation.answer(true)" />
              <app-button label="Leave As Is" (click)="confirmation.answer(false)" />
            </app-button-row>
          </div>
        </ng-template>
      </app-modal>
    }
  `,
})
export class LineTerminatorsConfirmModal {
  /**
   * Holds the confirmation whose open request this dialog shows.
   */
  protected readonly confirmation: LineTerminatorsConfirmation = inject(
    LineTerminatorsConfirmation,
  );
}
