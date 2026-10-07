import {
  ChangeDetectionStrategy,
  Component,
  input,
  InputSignal,
  output,
  OutputEmitterRef,
} from '@angular/core';
import { Radio } from '@shared/angular/components/forms/radio/radio';

/**
 * Describes one choice a card offers.
 */
export interface AgentChoice {
  /**
   * Gets the value the choice stands for.
   */
  readonly value: string;

  /**
   * Gets the choice's bold label.
   */
  readonly label: string;

  /**
   * Gets the sentence that says what choosing it means, or undefined when the label says it all.
   */
  readonly description?: string;
}

/**
 * The choices a card offers, as a radio list (#855): each row pairs a radio dial with a bold label and
 * a muted description, so a choice reads as its consequence rather than as a button. Shared by the
 * question card, where choosing selects and an Answer button confirms, and the edit-decision card,
 * where choosing is the decision.
 */
@Component({
  selector: 'app-agent-choice-list',
  imports: [Radio],
  templateUrl: './agent-choice-list.html',
  styleUrl: './agent-choice-list.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AgentChoiceList {
  /**
   * Gets the choices, in the order they are listed.
   */
  public readonly choices: InputSignal<readonly AgentChoice[]> =
    input.required<readonly AgentChoice[]>();

  /**
   * Gets the radio group's name, unique to the card.
   */
  public readonly name: InputSignal<string> = input.required<string>();

  /**
   * Gets the selected choice's value, or null when none is.
   */
  public readonly selected: InputSignal<string | null> = input<string | null>(null);

  /**
   * Gets what the group is announced as.
   */
  public readonly ariaLabel: InputSignal<string> = input<string>('');

  /**
   * Emits the value of a choice the user picks.
   */
  public readonly choose: OutputEmitterRef<string> = output<string>();
}
