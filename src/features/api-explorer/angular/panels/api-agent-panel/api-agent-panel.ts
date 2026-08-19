import { ChangeDetectionStrategy, Component, input, InputSignal } from '@angular/core';
import { AgentConversationPanel } from '@shared/angular/components/panels/agent-conversation-panel/agent-conversation-panel';
import { DockPanel } from '@shared/angular/services/dock-layout/dock-panel';

/**
 * Hosts the agent conversation inside an API Explorer tab.
 *
 * It exists rather than reusing the shared {@link import('@shared/angular/components/panels/agent-panel/agent-panel').AgentPanel}
 * for one reason: the surface. The shared panel runs on the `editor` surface, whose tools act on an
 * open document; this one runs on `api`, which is what makes the providers expose the API tools —
 * listing the collections, creating and changing saved requests, sending one, and setting an
 * environment variable — and what selects the system prompt telling the model to set an endpoint up
 * rather than only describe it.
 */
@Component({
  selector: 'app-api-agent-panel',
  imports: [AgentConversationPanel],
  template: '<app-agent-conversation-panel surface="api" />',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ApiAgentPanel {
  /**
   * Gets the dock panel descriptor this body renders. Supplied by the dock outlet, which sets it on
   * every projected panel component; unused here because the dock chrome renders the title.
   */
  public readonly panel: InputSignal<DockPanel> = input.required<DockPanel>();
}
