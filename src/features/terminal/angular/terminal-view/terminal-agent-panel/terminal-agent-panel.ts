import { ChangeDetectionStrategy, Component, inject, input, InputSignal } from '@angular/core';
import { Agent } from '@shared/angular/services/agent/agent';
import { AgentConversation } from '@shared/angular/services/agent-conversation/agent-conversation';
import { AGENT_CONVERSATION_KIND } from '@shared/angular/services/agent-conversations/agent-conversation-context';
import { TerminalAgents } from '@features/terminal/angular/terminal-agents/terminal-agents';
import { Log } from '@shared/angular/services/log/log';
import { Icon } from '@shared/angular/icons/icon';
import { AgentConversationPanel } from '@shared/angular/components/panels/agent-conversation-panel/agent-conversation-panel';
import { ToolPanel } from '@shared/angular/components/panels/tool-panel/tool-panel';

/**
 * Represents the docked agent panel for a terminal tab: this tab's title bar over the shared
 * {@link AgentConversationPanel} (strip + chat + history). The panel owns its per-tab conversation
 * (global context — a terminal has no file), and the agent acts only through the owning terminal via
 * the terminal capabilities (the `terminal` surface).
 */
@Component({
  selector: 'app-terminal-agent-panel',
  imports: [ToolPanel, AgentConversationPanel],
  // The conversation is provided here, not by the shared conversation panel: the side-panel system
  // keeps this host mounted while hidden, so the conversation (and an in-flight run) spans hide/show.
  providers: [Agent, AgentConversation, { provide: AGENT_CONVERSATION_KIND, useValue: 'terminal' }],
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
   * Holds the structured logger for agent-panel actions.
   */
  private readonly log: Log = inject(Log);

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
    this.log.info('terminal.agents', 'Terminal agent panel closed', this.tabId());
    this.terminalAgents.hide(this.tabId());
  }
}
