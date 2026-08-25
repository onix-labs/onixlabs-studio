import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Button } from '@shared/angular/components/forms/button/button';
import { Modal } from '@shared/angular/components/modal/modal';
import { ModalContent } from '@shared/angular/components/modal/modal-content';
import { IssueAgent } from '@shared/angular/services/issues/issue-agent';

/**
 * Asks before an issue replaces a conversation that already holds something.
 *
 * A component rather than markup in each host because Open in Agent is offered from two places — the
 * issue's row in the rail and the issue's own document — and the question they ask is the same
 * question. Dropped into a template, it draws nothing until {@link IssueAgent} has something to ask.
 */
@Component({
  selector: 'app-issue-agent-confirm',
  imports: [Button, Modal, ModalContent],
  templateUrl: './issue-agent-confirm.html',
  styleUrl: './issue-agent-confirm.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IssueAgentConfirm {
  /**
   * Holds the seam that owns both the question and the answer.
   */
  protected readonly issueAgent: IssueAgent = inject(IssueAgent);
}
