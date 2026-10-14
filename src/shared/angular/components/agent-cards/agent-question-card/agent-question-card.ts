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
import type { AiInputSelection } from '@shared/api/ai-types';
import type { AgentItem } from '@shared/angular/services/agent/agent';
import { Button } from '@shared/angular/components/forms/button/button';
import { ButtonRow } from '@shared/angular/components/forms/button-row/button-row';
import { AgentCard } from '../agent-card/agent-card';
import { AgentChoice, AgentChoiceList } from '../agent-choice-list/agent-choice-list';

/**
 * A question the agent asks the user (#855): its suggested answers as a radio list — or a checkbox
 * list when several may be picked — confirmed with Answer so a mis-click is recoverable, or skipped.
 * A free-form answer is typed in the composer.
 */
@Component({
  selector: 'app-agent-question-card',
  imports: [AgentCard, AgentChoiceList, Button, ButtonRow],
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
   * Emits the user's answer: the picked suggestions' labels, joined with ", " when several may be
   * picked, or null when they skip.
   */
  public readonly answer: OutputEmitterRef<string | null> = output<string | null>();

  /**
   * Gets how many suggestions the user may pick.
   */
  protected readonly selection: Signal<AiInputSelection> = computed(
    (): AiInputSelection => this.item().inputSelection ?? 'single',
  );

  /**
   * Holds the picked suggestions' labels, in the order the choices list them.
   */
  protected readonly selected: WritableSignal<readonly string[]> = signal<readonly string[]>([]);

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
   * Answers with the picked suggestions. Ignored while nothing is picked.
   */
  public confirm(): void {
    const picked: readonly string[] = this.selected();
    if (picked.length > 0) {
      this.answer.emit(picked.join(', '));
    }
  }

  /**
   * Picks a suggestion — replacing the pick for a one-of question, toggling it for a many-of one;
   * answering happens on confirm.
   * @param label The suggestion's label.
   */
  public select(label: string): void {
    if (this.selection() === 'single') {
      this.selected.set([label]);
      return;
    }
    const picked: Set<string> = new Set<string>(this.selected());
    if (!picked.delete(label)) {
      picked.add(label);
    }
    // Kept in the order the choices list them, so the answer reads in the agent's order, not the
    // order the user happened to tick.
    this.selected.set(
      this.choices()
        .map((choice: AgentChoice): string => choice.value)
        .filter((value: string): boolean => picked.has(value)),
    );
  }
}
