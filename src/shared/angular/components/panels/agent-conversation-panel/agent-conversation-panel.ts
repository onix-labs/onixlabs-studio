import { ChangeDetectionStrategy, Component, inject, input, InputSignal } from '@angular/core';
import type { AgentSurface } from '@shared/api/ai-types';
import { ConversationContext } from '@shared/api/agent-conversation-channels';
import { Agent } from '@shared/angular/services/agent/agent';
import { AgentConversation } from '@shared/angular/services/agent-conversation/agent-conversation';
import { Log } from '@shared/angular/services/log/log';
import { AgentChat } from '@shared/angular/components/agent-chat/agent-chat';
import { AgentToolStrip } from '@shared/angular/components/agent-tool-strip/agent-tool-strip';
import { AgentConversationList } from '@shared/angular/components/agent-conversation-list/agent-conversation-list';

/**
 * A docked agent panel: a compact tool strip above the conversation, whose body swaps between the
 * {@link AgentChat} and the conversation-history list as History is toggled. The strip, chat, and
 * history list all drive one conversation through the {@link Agent} and {@link AgentConversation}
 * instances provided by the HOST — deliberately not by this panel. The panel itself is disposable: a
 * dock tool stack destroys it whenever another panel in the stack activates, and a conversation
 * scoped here would lose its transcript and in-flight run on every switch. Each host provides the
 * pair at the level that owns the conversation's lifetime: the IDE views (workspace, source control)
 * for dock-hosted panels, and the feature agent panels for the side-panel system (which keeps them
 * mounted while hidden). It carries no title chrome of its own — the host frames it. The standalone
 * agent tab does not use this panel: it drives the conversation through the ribbon and shows history
 * in a side panel.
 */
@Component({
  selector: 'app-agent-conversation-panel',
  imports: [AgentToolStrip, AgentChat, AgentConversationList],
  templateUrl: './agent-conversation-panel.html',
  styleUrl: './agent-conversation-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AgentConversationPanel {
  /**
   * Holds the host-provided conversation this panel's strip/chat/history drive.
   */
  protected readonly conversation: AgentConversation = inject(AgentConversation);

  /**
   * Holds the host's live agent session, which this panel binds the owning document's language to.
   */
  private readonly agent: Agent = inject(Agent);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

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
   * Gets the language of the document this host owns (a Monaco identifier), which scopes the user's
   * standing prompts and skills for its runs (#300, #301). Undefined for a host with no document — the
   * terminal, the API Explorer — whose runs carry no language.
   */
  public readonly language: InputSignal<string | undefined> = input<string | undefined>(undefined);

  /**
   * Initializes a new instance of the {@link AgentConversationPanel} class, binding this host's context
   * signal into the conversation so the binding stays reactive (a file panel's context follows the
   * file as it is saved).
   */
  public constructor() {
    this.log.info('AgentConversationPanel', 'Mounted agent conversation panel');
    this.conversation.bindContext(this.context);
    // Bound here rather than on the chat leaf: a Mission Control tile mounts the same chat against the
    // same agent and knows nothing about documents, and a leaf that bound "no language" there would
    // unbind what the host set.
    this.agent.bindLanguage((): string | undefined => this.language());
  }
}
