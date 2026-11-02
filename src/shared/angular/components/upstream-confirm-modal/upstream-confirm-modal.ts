import { ChangeDetectionStrategy, Component, inject, Signal } from '@angular/core';
import { Button } from '@shared/angular/components/forms/button/button';
import { ButtonRow } from '@shared/angular/components/forms/button-row/button-row';
import { Modal } from '@shared/angular/components/modal/modal';
import { ModalContent } from '@shared/angular/components/modal/modal-content';
import {
  UpstreamChoice,
  UpstreamConfirmation,
  UpstreamQuestion,
} from '@shared/angular/services/upstream-confirmation/upstream-confirmation';

/**
 * Shows the question Set Upstream Automatically on Push asks when it is Ask: set the remote branch as
 * the new branch's upstream while pushing, push without, or cancel. Mounted once by the shell.
 */
@Component({
  selector: 'app-upstream-confirm-modal',
  imports: [Button, ButtonRow, Modal, ModalContent],
  templateUrl: './upstream-confirm-modal.html',
  styleUrl: './upstream-confirm-modal.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UpstreamConfirmModal {
  /**
   * Holds the confirmation service the question comes from.
   */
  private readonly confirmation: UpstreamConfirmation = inject(UpstreamConfirmation);

  /**
   * Gets the question awaiting an answer.
   */
  protected readonly question: Signal<UpstreamQuestion | null> = this.confirmation.pending;

  /**
   * Answers the question.
   * @param choice The user's choice.
   */
  protected answer(choice: UpstreamChoice): void {
    this.confirmation.answer(choice);
  }
}
