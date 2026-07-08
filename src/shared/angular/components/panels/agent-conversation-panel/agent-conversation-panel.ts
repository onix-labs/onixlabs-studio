import { ChangeDetectionStrategy, Component, inject, input, InputSignal } from '@angular/core';
import type { AgentSurface } from '@shared/api/ai-types';
import { ConversationContext } from '@shared/api/agent-conversation-channels';
import { Agent } from '@shared/angular/services/agent/agent';
import { AgentConversation } from '@shared/angular/services/agent-conversation/agent-conversation';
import { AgentChat } from '@shared/angular/components/agent-chat/agent-chat';
import { AgentToolStrip } from '@shared/angular/components/agent-tool-strip/agent-tool-strip';
import { AgentConversationList } from '@shared/angular/components/agent-conversation-list/agent-conversation-list';

/**
 * A docked agent panel: a compact tool strip above the conversation, whose body swaps between the
 * {@link AgentChat} and the conversation-history list as History is toggled. It provides the
 * per-instance {@link Agent} and {@link AgentConversation}, so the strip, chat, and history list all
 * drive one conversation through the shared services. It carries no title chrome of its own — the host
 * (the dock, or a feature panel's tool-panel wrapper) frames it. The standalone agent tab does not use
 * this panel: it drives the conversation through the ribbon and shows history in a side panel.
 */
@Component({
  selector: 'app-agent-conversation-panel',
  imports: [AgentToolStrip, AgentChat, AgentConversationList],
  providers: [Agent, AgentConversation],
  templateUrl: './agent-conversation-panel.html',
  styleUrl: './agent-conversation-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AgentConversationPanel {
  /**
   * Holds the conversation this panel provides and its strip/chat/history drive.
   */
  protected readonly conversation: AgentConversation = inject(AgentConversation);

  /**
   * Gets the identifier of the tab hosting this conversation, forwarded to the chat.
   */
  public readonly tabId: InputSignal<string | undefined> = input<string | undefined>(undefined);

  /**
   * Gets a value indicating whether the hosting tab is active, forwarded to the chat.
   */
  public readonly isActive: InputSignal<boolean> = input<boolean>(false);

  /**
   * Gets what this conversation's runs act on (the tool set the providers expose), forwarded to the
   * chat.
   */
  public readonly surface: InputSignal<AgentSurface> = input<AgentSurface>('editor');

  /**
   * Gets the explicit conversation context for this host (a file's path), bound to the conversation so
   * its persistence and history are scoped to it. Omitted for hosts that rely on the injected IDE
   * resolver or the global bucket.
   */
  public readonly context: InputSignal<ConversationContext | undefined> = input<
    ConversationContext | undefined
  >(undefined);

  /**
   * Initializes a new instance of the {@link AgentConversationPanel} class, binding this host's context
   * signal into the conversation so the binding stays reactive (a file panel's context follows the
   * file as it is saved).
   */
  public constructor() {
    this.conversation.bindContext(this.context);
  }
}
