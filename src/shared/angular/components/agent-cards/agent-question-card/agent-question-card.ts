import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  InputSignal,
  output,
  OutputEmitterRef,
  signal,
  Signal,
  WritableSignal,
} from '@angular/core';
import type { AgentItem } from '@shared/angular/services/agent/agent';
import { Button } from '@shared/angular/components/forms/button/button';
import { AgentCard } from '../agent-card/agent-card';
import { AgentChoice, AgentChoiceList } from '../agent-choice-list/agent-choice-list';

/**
 * A question the agent asks the user (#855): its suggested answers as a radio list, confirmed with
 * Answer so a mis-click is recoverable, or skipped. A free-form answer is typed in the composer.
 */
@Component({
  selector: 'app-agent-question-card',
  imports: [AgentCard, AgentChoiceList, Button],
  templateUrl: './agent-question-card.html',
  styleUrl: './agent-question-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AgentQuestionCard {
  /**
   * Gets the input-request item.
   */
  public readonly item: InputSignal<AgentItem> = input.required<AgentItem>();

  /**
   * Emits the user's answer: a suggested choice's label, or null when they skip.
   */
  public readonly answer: OutputEmitterRef<string | null> = output<string | null>();

  /**
   * Holds the selected suggestion, or null until one is picked.
   */
  protected readonly selected: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Gets the suggestions as choices.
   */
  protected readonly choices: Signal<readonly AgentChoice[]> = computed(
    (): readonly AgentChoice[] =>
      (this.item().inputChoices ?? []).map(
        (choice: { label: string; description?: string }): AgentChoice => ({
          value: choice.label,
          label: choice.label,
          ...(choice.description === undefined ? {} : { description: choice.description }),
        }),
      ),
  );

  /**
   * Answers with the selected suggestion. Ignored while nothing is selected.
   */
  public confirm(): void {
    const choice: string | null = this.selected();
    if (choice !== null) {
      this.answer.emit(choice);
    }
  }

  /**
   * Selects a suggestion; answering happens on confirm.
   * @param label The suggestion's label.
   */
  public select(label: string): void {
    this.selected.set(label);
  }
}
