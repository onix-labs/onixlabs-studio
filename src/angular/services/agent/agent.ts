import { Service, signal, Signal, WritableSignal } from '@angular/core';

/**
 * Identifies who authored a conversation message.
 */
export type AgentMessageRole = 'user' | 'assistant';

/**
 * Describes a single message in the agent conversation.
 */
export interface AgentMessage {
  /**
   * Gets the unique identifier of the message.
   */
  readonly id: string;

  /**
   * Gets the author of the message.
   */
  readonly role: AgentMessageRole;

  /**
   * Gets the message text.
   */
  readonly text: string;
}

/**
 * Holds the assistant's opening message.
 */
const WELCOME_MESSAGE: AgentMessage = {
  id: 'agent-welcome',
  role: 'assistant',
  text: 'Hi! I am your workspace agent. Ask me anything about your project.',
};

/**
 * Represents the conversation state behind the agent chat shell. This is the seam the real agent
 * runtime fills in the v0.4 AI Agent milestone: today {@link send} simply echoes a stub reply so the
 * UI is fully exercised; later it will stream model responses and run tools. The conversation is
 * exposed as a signal so any surface (the agent tab and the dockable agent panel) renders the same
 * state.
 */
@Service()
export class Agent {
  /**
   * Holds the ordered conversation, seeded with the assistant's welcome message.
   */
  private readonly log: WritableSignal<readonly AgentMessage[]> = signal<readonly AgentMessage[]>([
    WELCOME_MESSAGE,
  ]);

  /**
   * Tracks the running counter used to generate unique message identifiers.
   */
  private sequence: number = 0;

  /**
   * Gets the ordered conversation.
   */
  public readonly messages: Signal<readonly AgentMessage[]> = this.log.asReadonly();

  /**
   * Sends a user message and appends the assistant's reply. Blank messages are ignored. The reply is
   * a placeholder until the agent runtime is wired up.
   * @param text The user's message.
   */
  public send(text: string): void {
    const trimmed: string = text.trim();
    if (trimmed.length === 0) {
      return;
    }
    this.append('user', trimmed);
    this.append('assistant', this.stubReply(trimmed));
  }

  /**
   * Clears the conversation back to the welcome message.
   */
  public clear(): void {
    this.log.set([WELCOME_MESSAGE]);
  }

  /**
   * Appends a message to the conversation with a fresh identifier.
   * @param role The author of the message.
   * @param text The message text.
   */
  private append(role: AgentMessageRole, text: string): void {
    this.sequence += 1;
    const message: AgentMessage = { id: `agent-${this.sequence}`, role, text };
    this.log.update((messages: readonly AgentMessage[]): readonly AgentMessage[] => [
      ...messages,
      message,
    ]);
  }

  /**
   * Builds the placeholder assistant reply shown until the runtime is connected.
   * @param prompt The user's message.
   * @returns Returns the stub reply.
   */
  private stubReply(prompt: string): string {
    return `The agent runtime isn't connected yet, so I can't act on "${prompt}". Live responses arrive in the AI Agent milestone (v0.4).`;
  }
}
