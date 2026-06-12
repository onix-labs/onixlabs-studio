import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
  Signal,
  WritableSignal,
} from '@angular/core';
import { Agent, AgentMessage } from '../../../services/agent/agent';

/**
 * Renders the agent conversation as a chat shell: a scrolling message list above a composer. State
 * lives in the {@link Agent} service, so this component is shared by the agent tab and the dockable
 * agent panel and both show the same conversation. Sending echoes a stub reply until the runtime is
 * wired up in the v0.4 AI Agent milestone.
 */
@Component({
  selector: 'app-agent-chat',
  imports: [],
  templateUrl: './agent-chat.html',
  styleUrl: './agent-chat.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AgentChat {
  /**
   * Holds the agent conversation service.
   */
  private readonly agent: Agent = inject(Agent);

  /**
   * Holds the current composer text.
   */
  private readonly draftText: WritableSignal<string> = signal<string>('');

  /**
   * Gets the conversation rendered in the message list.
   */
  public readonly messages: Signal<readonly AgentMessage[]> = this.agent.messages;

  /**
   * Gets the current composer text.
   */
  public readonly draft: Signal<string> = this.draftText.asReadonly();

  /**
   * Records composer input.
   * @param value The new composer text.
   */
  public onInput(value: string): void {
    this.draftText.set(value);
  }

  /**
   * Sends the current draft to the agent and clears the composer. Blank drafts are ignored.
   */
  public send(): void {
    const text: string = this.draftText();
    if (text.trim().length === 0) {
      return;
    }
    this.agent.send(text);
    this.draftText.set('');
  }

  /**
   * Handles composer key presses: sends on Enter, but leaves Shift+Enter to insert a newline.
   * @param event The keyboard event.
   */
  public onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' || event.shiftKey) {
      return;
    }
    event.preventDefault();
    this.send();
  }
}
