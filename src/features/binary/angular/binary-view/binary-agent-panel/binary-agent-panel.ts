import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  InputSignal,
  Signal,
} from '@angular/core';
import { ConversationContext } from '@shared/api/agent-conversation-channels';
import { Icon } from '@shared/angular/icons/icon';
import { AgentConversationPanel } from '@shared/angular/components/panels/agent-conversation-panel/agent-conversation-panel';
import { ToolPanel } from '@shared/angular/components/panels/tool-panel/tool-panel';
import { Log } from '@shared/angular/services/log/log';
import { BinaryDocuments } from '../../binary-document/binary-document';
import { BinaryPanels } from '../../binary-panels/binary-panels';

/**
 * Represents the docked agent panel for a binary tab: this tab's title bar over the shared
 * {@link AgentConversationPanel} (strip + chat + history), run on the `binary` surface. The panel owns
 * its per-tab conversation, scoped to this file's path, and the agent reads the open binary's
 * hex/ASCII/disassembly (and can patch its bytes) through the binary capabilities.
 */
@Component({
  selector: 'app-binary-agent-panel',
  imports: [ToolPanel, AgentConversationPanel],
  // The conversation is provided by the owning BinaryView, not here: this panel mounts lazily on
  // first show, so the conversation (an in-flight run, the Mission Control registration) must
  // outlive it — it spans the tab, not the panel.
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
   * Holds the binary document registry, used to resolve this tab's file path for the conversation
   * context.
   */
  private readonly binaryDocuments: BinaryDocuments = inject(BinaryDocuments);

  /**
   * Holds the structured logger for agent-panel interactions.
   */
  private readonly log: Log = inject(Log);

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
   * Gets this tab's conversation context: the binary file's path when known, else undefined so the
   * chat falls back to its workspace/global context.
   */
  protected readonly fileContext: Signal<ConversationContext | undefined> = computed(
    (): ConversationContext | undefined => {
      const path: string | undefined = this.binaryDocuments.get(this.tabId())?.path;
      return path === undefined ? undefined : { kind: 'file', key: path };
    },
  );

  /**
   * Hides the agent panel, leaving its conversation mounted so it can be reopened.
   */
  protected onClose(): void {
    this.log.info('binary.agent', 'Agent panel closed', this.tabId());
    this.binaryPanels.hide(this.tabId(), 'agent');
  }
}
