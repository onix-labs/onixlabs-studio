import { ChangeDetectionStrategy, Component, inject, Signal } from '@angular/core';
import { Button } from '@shared/angular/components/forms/button/button';
import { ButtonRow } from '@shared/angular/components/forms/button-row/button-row';
import { Modal } from '@shared/angular/components/modal/modal';
import { ModalContent } from '@shared/angular/components/modal/modal-content';
import {
  TerminalConfirmation,
  TerminalQuestion,
} from '@shared/angular/services/terminal-confirmation/terminal-confirmation';

/**
 * Represents the dialog a terminal asks its questions in: pasting several lines, closing while a
 * program runs. It shows the open {@link TerminalConfirmation} question, names the setting that asks
 * it, and answers it.
 */
@Component({
  selector: 'app-terminal-confirm-modal',
  imports: [Button, ButtonRow, Modal, ModalContent],
  templateUrl: './terminal-confirm-modal.html',
  styleUrl: './terminal-confirm-modal.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TerminalConfirmModal {
  /**
   * Holds the service whose question is shown.
   */
  private readonly confirmation: TerminalConfirmation = inject(TerminalConfirmation);

  /**
   * Gets the open question, or null when none is.
   */
  protected readonly question: Signal<TerminalQuestion | null> = this.confirmation.pending;

  /**
   * Answers the question.
   * @param confirmed Whether the user goes ahead.
   */
  protected answer(confirmed: boolean): void {
    this.confirmation.answer(confirmed);
  }
}
