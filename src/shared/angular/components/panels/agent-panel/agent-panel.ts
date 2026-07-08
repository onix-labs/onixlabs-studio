import { ChangeDetectionStrategy, Component, input, InputSignal } from '@angular/core';
import { DockPanel } from '@shared/angular/services/dock/dock-panel';
import { AgentConversationPanel } from '@shared/angular/components/panels/agent-conversation-panel/agent-conversation-panel';

/**
 * Hosts the agent conversation as a dockable IDE panel. It composes the shared
 * {@link AgentConversationPanel} (strip + chat + history), whose context resolves from the IDE view's
 * provided {@link import('../../../services/agent-conversations/agent-conversation-context').AGENT_CONVERSATION_CONTEXT}
 * resolver (workspace or repository). The dock chrome supplies the title bar.
 */
@Component({
  selector: 'app-agent-panel',
  imports: [AgentConversationPanel],
  templateUrl: './agent-panel.html',
  styleUrl: './agent-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AgentPanel {
  /**
   * Gets the dock panel descriptor this body renders. Supplied by the dock outlet, which sets it on
   * every projected panel component; unused here because the dock chrome renders the title.
   */
  public readonly panel: InputSignal<DockPanel> = input.required<DockPanel>();
}
