import { ChangeDetectionStrategy, Component, input, InputSignal } from '@angular/core';
import { DockPanel } from '@shared/angular/services/dock/dock-panel';
import { AgentChat } from '@shared/angular/components/agent-chat/agent-chat';

/**
 * Hosts the agent conversation as a dockable IDE panel. It shares the {@link AgentChat} shell and
 * the Agent service with the agent tab, so the same conversation appears wherever the agent is
 * shown. The dock chrome supplies the title bar.
 */
@Component({
  selector: 'app-agent-panel',
  imports: [AgentChat],
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
