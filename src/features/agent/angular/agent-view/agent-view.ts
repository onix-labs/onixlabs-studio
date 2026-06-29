import { ChangeDetectionStrategy, Component, input, InputSignal } from '@angular/core';
import { AgentChat } from '@shared/angular/components/agent-chat/agent-chat';

/**
 * Hosts the agent conversation as a top-level tab. The chat shell lives in {@link AgentChat}, which
 * owns this tab's own agent session — the transcript is per-tab, not shared with other agent tabs or
 * the dockable agent panel.
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
   * Gets the identifier of the tab hosting this view.
   */
  public readonly tabId: InputSignal<string | undefined> = input<string | undefined>(undefined);

  /**
   * Gets a value indicating whether the view belongs to the active tab.
   */
  public readonly isActive: InputSignal<boolean> = input<boolean>(false);
}
