import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  InputSignal,
  Signal,
} from '@angular/core';
import { ConversationContext } from '@shared/api/agent-conversation-channels';
import { Agent } from '@shared/angular/services/agent/agent';
import { AgentConversation } from '@shared/angular/services/agent-conversation/agent-conversation';
import { AGENT_CONVERSATION_KIND } from '@shared/angular/services/agent-conversations/agent-conversation-context';
import { CodeAgents } from '@features/code/angular/code-agents/code-agents';
import { Documents } from '@shared/angular/services/documents/documents';
import { Icon } from '@shared/angular/icons/icon';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { PanelDragHandle } from '@shared/angular/components/panel-layout/panel-drag-handle';
import { AgentConversationPanel } from '@shared/angular/components/panels/agent-conversation-panel/agent-conversation-panel';

/**
 * Represents the docked agent panel for a code tab: this tab's title bar over the shared
 * {@link AgentConversationPanel} (strip + chat + history). The panel owns its per-tab conversation,
 * scoped to this file's path, and the agent reads the active code document through the editor
 * capabilities.
 */
@Component({
  selector: 'app-code-agent-panel',
  imports: [AgentConversationPanel, AppIcon, PanelDragHandle],
  // The conversation is provided here, not by the shared conversation panel: the side-panel system
  // keeps this host mounted while hidden, so the conversation (and an in-flight run) spans hide/show.
  providers: [Agent, AgentConversation, { provide: AGENT_CONVERSATION_KIND, useValue: 'code' }],
  templateUrl: './code-agent-panel.html',
  styleUrl: './code-agent-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CodeAgentPanel {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the docked agent-panel state.
   */
  private readonly codeAgents: CodeAgents = inject(CodeAgents);

  /**
   * Holds the document registry, used to resolve this tab's file path for the conversation context.
   */
  private readonly documents: Documents = inject(Documents);

  /**
   * Gets the identifier of the owning code tab. Always supplied by the host; the empty default lets
   * the panel be constructed before its input binding is applied.
   */
  public readonly tabId: InputSignal<string> = input<string>('');

  /**
   * Gets a value indicating whether the panel belongs to the active, visible tab.
   */
  public readonly isActive: InputSignal<boolean> = input<boolean>(false);

  /**
   * Gets this tab's conversation context: the code file's path when it is saved, else undefined so
   * the chat falls back to its workspace/global context.
   */
  protected readonly fileContext: Signal<ConversationContext | undefined> = computed(
    (): ConversationContext | undefined => {
      const path: string | null = this.documents.get(this.tabId())?.filePath() ?? null;
      return path === null ? undefined : { kind: 'file', key: path };
    },
  );

  /**
   * Hides the agent panel, leaving its conversation mounted so it can be reopened.
   */
  protected onClose(): void {
    this.codeAgents.hide(this.tabId());
  }
}
