import {
  ChangeDetectionStrategy,
  Component,
  input,
  InputSignal,
  output,
  OutputEmitterRef,
} from '@angular/core';
import type { AiInputSelection } from '@shared/api/ai-types';
import { Checkbox } from '@shared/angular/components/forms/checkbox/checkbox';
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
 * where choosing is the decision. A question whose choices are not mutually exclusive draws checkboxes
 * instead, so an AND choice does not read as an OR.
 */
@Component({
  selector: 'app-agent-choice-list',
  imports: [Checkbox, Radio],
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
   * Gets how many choices may be picked: one, drawn as radios, or any number, drawn as checkboxes.
   */
  public readonly selection: InputSignal<AiInputSelection> = input<AiInputSelection>('single');

  /**
   * Gets the values of the picked choices; at most one unless {@link selection} is `'multiple'`.
   */
  public readonly selected: InputSignal<readonly string[]> = input<readonly string[]>([]);

  /**
   * Gets what the group is announced as.
   */
  public readonly ariaLabel: InputSignal<string> = input<string>('');

  /**
   * Emits the value of a choice the user picks — or, for a multiple selection, ticks or unticks.
   */
  public readonly choose: OutputEmitterRef<string> = output<string>();
}
