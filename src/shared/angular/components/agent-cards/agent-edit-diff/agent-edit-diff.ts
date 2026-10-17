import { ChangeDetectionStrategy, Component, input, InputSignal } from '@angular/core';
import { ProposedDiff } from './proposed-diff';

/**
 * Shows a change an agent proposes to a file, in the conversation (#891): the file, how many lines
 * it adds and removes, and the changed lines with a few unchanged ones around them, numbered as they
 * are in the file before and after.
 *
 * Unified rather than side by side, because it sits in a conversation, which is narrow more often
 * than not.
 */
@Component({
  selector: 'app-agent-edit-diff',
  templateUrl: './agent-edit-diff.html',
  styleUrl: './agent-edit-diff.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AgentEditDiff {
  /**
   * Gets the change to show.
   */
  public readonly diff: InputSignal<ProposedDiff> = input.required<ProposedDiff>();
}
