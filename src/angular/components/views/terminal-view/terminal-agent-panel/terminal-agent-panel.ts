import { ChangeDetectionStrategy, Component, inject, input, InputSignal } from '@angular/core';
import { TerminalAgents } from '../../../../services/terminal-agents/terminal-agents';
import { Icon } from '@shared/angular/icons/icon';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { AgentChat } from '../../../shared/agent-chat/agent-chat';

/**
 * Represents the docked agent panel for a terminal tab: a small toolbar over the shared
 * {@link AgentChat} conversation. Each tab gets its own agent session (AgentChat provides the Agent
 * service per instance), and the agent acts only through the owning terminal via the terminal
 * capabilities (the `terminal` surface).
 */
@Component({
  selector: 'app-terminal-agent-panel',
  imports: [AgentChat, AppIcon],
  templateUrl: './terminal-agent-panel.html',
  styleUrl: './terminal-agent-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TerminalAgentPanel {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the docked agent-panel state.
   */
  private readonly terminalAgents: TerminalAgents = inject(TerminalAgents);

  /**
   * Gets the identifier of the owning terminal tab. Always supplied by the host; the empty default
   * lets the panel be constructed before its input binding is applied.
   */
  public readonly tabId: InputSignal<string> = input<string>('');

  /**
   * Gets a value indicating whether the panel belongs to the active, visible tab.
   */
  public readonly isActive: InputSignal<boolean> = input<boolean>(false);

  /**
   * Hides the agent panel, leaving its conversation mounted so it can be reopened.
   */
  protected onClose(): void {
    this.terminalAgents.hide(this.tabId());
  }
}
