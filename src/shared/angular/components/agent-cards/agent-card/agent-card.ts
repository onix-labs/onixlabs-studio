import { ChangeDetectionStrategy, Component, input, InputSignal } from '@angular/core';

/**
 * Names how a card in the conversation stands: waiting on the user (outlined in the accent colour), a
 * failed run (outlined in the warning colour), or settled.
 */
export type AgentCardTone = 'pending' | 'error' | 'settled';

/**
 * The shell every prompt card in an agent conversation shares (#855): the raised surface, the outline
 * that says whether it waits on the user, and the app's corner shape. Its content is projected, so each
 * card says what it asks and the shell only says how it stands.
 */
@Component({
  selector: 'app-agent-card',
  imports: [],
  template: '<ng-content />',
  styleUrl: './agent-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.agent-card--pending]': "tone() === 'pending'",
    '[class.agent-card--error]': "tone() === 'error'",
  },
})
export class AgentCard {
  /**
   * Gets how the card stands.
   */
  public readonly tone: InputSignal<AgentCardTone> = input<AgentCardTone>('settled');
}
