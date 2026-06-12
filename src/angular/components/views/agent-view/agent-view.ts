import { ChangeDetectionStrategy, Component, input, InputSignal } from '@angular/core';
import { AgentChat } from '../../shared/agent-chat/agent-chat';

/**
 * Hosts the agent conversation as a top-level tab. The chat shell and its state live in
 * {@link AgentChat} and the Agent service, shared with the dockable agent panel.
 */
@Component({
  selector: 'app-agent-view',
  imports: [AgentChat],
  templateUrl: './agent-view.html',
  styleUrl: './agent-view.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AgentView {
  /**
   * Gets a value indicating whether the view belongs to the active tab.
   */
  public readonly isActive: InputSignal<boolean> = input<boolean>(false);
}
