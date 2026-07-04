import { ChangeDetectionStrategy, Component, inject, input, InputSignal } from '@angular/core';
import { CodeAgents } from '@features/code/angular/code-agents/code-agents';
import { Icon } from '@shared/angular/icons/icon';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { AgentChat } from '@shared/angular/components/agent-chat/agent-chat';

/**
 * Represents the docked agent panel for a code tab: a small toolbar over the shared {@link AgentChat}
 * conversation. Each tab gets its own agent session (AgentChat provides the Agent service per
 * instance), and the agent reads the active code document through the editor capabilities.
 */
@Component({
  selector: 'app-code-agent-panel',
  imports: [AgentChat, AppIcon],
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
   * Gets the identifier of the owning code tab. Always supplied by the host; the empty default lets
   * the panel be constructed before its input binding is applied.
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
    this.codeAgents.hide(this.tabId());
  }
}
