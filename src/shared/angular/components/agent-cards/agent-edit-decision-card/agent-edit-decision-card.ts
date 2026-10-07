import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  InputSignal,
  output,
  OutputEmitterRef,
  Signal,
} from '@angular/core';
import type { AiEditDecision } from '@shared/api/ai-types';
import type { AgentItem } from '@shared/angular/services/agent/agent';
import { AgentCard } from '../agent-card/agent-card';
import { AgentChoice, AgentChoiceList } from '../agent-choice-list/agent-choice-list';

/**
 * The choices an edit-decision card offers, in the order they are listed: the plain yes, the yes that
 * stops the asking for the rest of the session, and no. Each carries the sentence that says what
 * choosing it does, so the row reads as a consequence rather than a button label.
 */
const EDIT_DECISION_CHOICES: readonly AgentChoice[] = [
  { value: 'yes', label: 'Yes', description: 'Apply this edit.' },
  {
    value: 'yes-auto',
    label: 'Yes, and automatically accept edits',
    description: 'Apply it, and stop asking for the rest of this session.',
  },
  { value: 'no', label: 'No', description: 'Leave the document as it is.' },
];

/**
 * Asks whether to apply an edit the agent made to a document (#855). The choices are a radio list, as
 * the question card draws its suggestions, rather than three stacked buttons: full-width buttons made
 * "No" as loud as "Yes, and automatically accept edits". Choosing a row IS the decision — there is no
 * confirm step, because a decision prompt with a second button to press is two prompts.
 */
@Component({
  selector: 'app-agent-edit-decision-card',
  imports: [AgentCard, AgentChoiceList],
  templateUrl: './agent-edit-decision-card.html',
  styleUrl: './agent-edit-decision-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AgentEditDecisionCard {
  /**
   * Gets the edit-decision item.
   */
  public readonly item: InputSignal<AgentItem> = input.required<AgentItem>();

  /**
   * Emits the user's decision.
   */
  public readonly decide: OutputEmitterRef<AiEditDecision> = output<AiEditDecision>();

  /**
   * Gets the choices offered.
   */
  protected readonly choices: readonly AgentChoice[] = EDIT_DECISION_CHOICES;

  /**
   * Gets the settled state line.
   */
  protected readonly stateLabel: Signal<string> = computed((): string => {
    const item: AgentItem = this.item();
    switch (item.decisionState) {
      case 'applied':
        return item.decisionAuto === true
          ? 'Applied · auto-accepting edits this session'
          : 'Applied';
      case 'rejected':
        return 'Rejected';
      default:
        return 'Not decided';
    }
  });

  /**
   * Decides, from a chosen row.
   * @param value The chosen value.
   */
  protected choose(value: string): void {
    this.decide.emit(value as AiEditDecision);
  }
}
