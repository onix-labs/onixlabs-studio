import { ChangeDetectionStrategy, Component, inject, input, InputSignal } from '@angular/core';
import { Icon } from '@shared/angular/icons/icon';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { AgentChat } from '@shared/angular/components/agent-chat/agent-chat';
import { BinaryPanels } from '../../binary-panels/binary-panels';

/**
 * Represents the docked agent panel for a binary tab: a small toolbar over the shared {@link AgentChat}
 * conversation, run on the `binary` surface. Each tab gets its own agent session (AgentChat provides
 * the Agent service per instance), and the agent reads the open binary's hex/ASCII/disassembly (and
 * can patch its bytes) through the binary capabilities.
 */
@Component({
  selector: 'app-binary-agent-panel',
  imports: [AgentChat, AppIcon],
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
   * Gets the identifier of the owning binary tab. Always supplied by the host; the empty default lets
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
    this.binaryPanels.hide(this.tabId(), 'agent');
  }
}
