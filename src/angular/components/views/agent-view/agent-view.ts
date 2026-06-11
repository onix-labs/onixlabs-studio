import { ChangeDetectionStrategy, Component, input, InputSignal } from '@angular/core';

/**
 * Identifies the author of a message in the agent conversation.
 */
type AgentMessageRole = 'user' | 'assistant';

/**
 * Describes a single message shown in the agent conversation.
 */
interface AgentMessage {
  /**
   * Gets the identifier of the message.
   */
  readonly id: string;

  /**
   * Gets the author of the message.
   */
  readonly role: AgentMessageRole;

  /**
   * Gets the text content of the message.
   */
  readonly text: string;
}

/**
 * Represents the AI agent view, presenting a chat shell of a message list and a composer. The
 * conversation is a non-functional placeholder pending the agent chat implementation.
 */
@Component({
  selector: 'app-agent-view',
  imports: [],
  templateUrl: './agent-view.html',
  styleUrl: './agent-view.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AgentView {
  /**
   * Gets a value indicating whether the view belongs to the active tab.
   */
  public readonly isActive: InputSignal<boolean> = input<boolean>(false);

  /**
   * Gets the placeholder conversation shown in the message list.
   */
  protected readonly messages: readonly AgentMessage[] = [
    {
      id: 'm1',
      role: 'assistant',
      text: 'Hi! I am your workspace agent. Ask me anything about your project.',
    },
    { id: 'm2', role: 'user', text: 'What will you be able to help with?' },
    {
      id: 'm3',
      role: 'assistant',
      text: 'Once wired up, I will read files, run tasks, and explain code. This is a placeholder layout for now.',
    },
  ];
}
