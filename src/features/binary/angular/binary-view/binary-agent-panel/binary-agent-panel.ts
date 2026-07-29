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
import { Icon } from '@shared/angular/icons/icon';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { PanelDragHandle } from '@shared/angular/components/panel-layout/panel-drag-handle';
import { AgentConversationPanel } from '@shared/angular/components/panels/agent-conversation-panel/agent-conversation-panel';
import { Button } from '@shared/angular/components/forms/button/button';
import { BinaryDocuments } from '../../binary-document/binary-document';
import { BinaryPanels } from '../../binary-panels/binary-panels';

/**
 * Represents the docked agent panel for a binary tab: this tab's title bar over the shared
 * {@link AgentConversationPanel} (strip + chat + history), run on the `binary` surface. The panel owns
 * its per-tab conversation, scoped to this file's path, and the agent reads the open binary's
 * hex/ASCII/disassembly (and can patch its bytes) through the binary capabilities.
 */
@Component({
  selector: 'app-binary-agent-panel',
  imports: [Button, AgentConversationPanel, AppIcon, PanelDragHandle],
  // The conversation is provided here, not by the shared conversation panel: the side-panel system
  // keeps this host mounted while hidden, so the conversation (and an in-flight run) spans hide/show.
  providers: [Agent, AgentConversation, { provide: AGENT_CONVERSATION_KIND, useValue: 'code' }],
  templateUrl: './binary-agent-panel.html',
  styleUrl: './binary-agent-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BinaryAgentPanel {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the docked side-panel state, used to hide the agent panel when it is closed.
   */
  private readonly binaryPanels: BinaryPanels = inject(BinaryPanels);

  /**
   * Holds the binary document registry, used to resolve this tab's file path for the conversation
   * context.
   */
  private readonly binaryDocuments: BinaryDocuments = inject(BinaryDocuments);

  /**
   * Gets the identifier of the owning binary tab. Always supplied by the host; the empty default lets
   * the panel be constructed before its input binding is applied.
   */
  public readonly tabId: InputSignal<string> = input<string>('');

  /**
   * Gets a value indicating whether the panel belongs to the active, visible tab.
   */
  public readonly isActive: InputSignal<boolean> = input<boolean>(false);

  /**
   * Gets this tab's conversation context: the binary file's path when known, else undefined so the
   * chat falls back to its workspace/global context.
   */
  protected readonly fileContext: Signal<ConversationContext | undefined> = computed(
    (): ConversationContext | undefined => {
      const path: string | undefined = this.binaryDocuments.get(this.tabId())?.path;
      return path === undefined ? undefined : { kind: 'file', key: path };
    },
  );

  /**
   * Hides the agent panel, leaving its conversation mounted so it can be reopened.
   */
  protected onClose(): void {
    this.binaryPanels.hide(this.tabId(), 'agent');
  }
}
