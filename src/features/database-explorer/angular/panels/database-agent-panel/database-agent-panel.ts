import { ChangeDetectionStrategy, Component, input, InputSignal } from '@angular/core';
import { AgentConversationPanel } from '@shared/angular/components/panels/agent-conversation-panel/agent-conversation-panel';
import { DockPanel } from '@shared/angular/services/dock-layout/dock-panel';

/**
 * The Database Explorer's agent: the shared conversation panel on the `database` surface, which is what
 * makes the providers offer the database tools — inspecting connections and schemas, writing queries
 * into the document, and running one with the user's permission.
 */
@Component({
  selector: 'app-database-agent-panel',
  imports: [AgentConversationPanel],
  template: '<app-agent-conversation-panel surface="database" />',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DatabaseAgentPanel {
  /**
   * Gets the dock panel this component is projected into.
   */
  public readonly panel: InputSignal<DockPanel> = input.required<DockPanel>();
}
