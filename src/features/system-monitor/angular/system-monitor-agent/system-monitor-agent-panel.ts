import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  InputSignal,
  output,
  OutputEmitterRef,
  untracked,
} from '@angular/core';
import { ConversationContext } from '@shared/api/agent-conversation-channels';
import {
  toolViewConversationContext,
  ToolViewAgentPanel,
} from '@shared/angular/components/panels/tool-view-agent-panel/tool-view-agent-panel';
import { Agent, AgentItem } from '@shared/angular/services/agent/agent';

/**
 * The context every System Monitor conversation is filed under (#966): the tool view, keyed by its
 * agent surface, so its history is its own.
 */
export const SYSTEM_MONITOR_CONVERSATION_CONTEXT: ConversationContext =
  toolViewConversationContext('monitor');

/**
 * The notice a System Monitor conversation carries once (#966). Logs hold file paths, project names
 * and what the app has been doing, and an agent that reads them sends them to its provider.
 */
export const LOG_PRIVACY_NOTICE: string = 'Logs the agent reads are sent to your AI provider';

/**
 * The notice's explanation.
 */
const LOG_PRIVACY_DETAIL: string =
  'They can include file paths, project names and what Studio has been doing. With a local model they stay on this machine.';

/**
 * The System Monitor's docked agent (#966): the shared tool-view agent panel on the `monitor` surface,
 * adding the notice every System Monitor conversation carries.
 */
@Component({
  selector: 'app-system-monitor-agent-panel',
  imports: [ToolViewAgentPanel],
  template: `
    <app-tool-view-agent-panel
      surface="monitor"
      [context]="context"
      [tabId]="tabId()"
      [isActive]="isActive()"
      (closed)="closed.emit()"
    />
  `,
  styles: `
    :host {
      display: block;
      inline-size: 100%;
      block-size: 100%;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SystemMonitorAgentPanel {
  /**
   * Gets the conversation context, the same for every System Monitor conversation.
   */
  protected readonly context: ConversationContext = SYSTEM_MONITOR_CONVERSATION_CONTEXT;

  /**
   * Gets the identifier of the System Monitor tab.
   */
  public readonly tabId: InputSignal<string> = input<string>('');

  /**
   * Gets whether the panel belongs to the active, visible tab.
   */
  public readonly isActive: InputSignal<boolean> = input<boolean>(false);

  /**
   * Raised when the user closes the panel.
   */
  public readonly closed: OutputEmitterRef<void> = output<void>();

  /**
   * Adds the privacy notice to each conversation once, as it starts: when the first message is sent, so
   * a conversation restored from history that already carries it is not told twice.
   */
  public constructor() {
    const agent: Agent = inject(Agent);
    effect((): void => {
      const items: readonly AgentItem[] = agent.items();
      if (needsPrivacyNotice(items)) {
        untracked((): void => agent.note(LOG_PRIVACY_NOTICE, LOG_PRIVACY_DETAIL));
      }
    });
  }
}

/**
 * Determines whether a transcript is due the privacy notice: it has begun, and does not carry it yet.
 * @param items The transcript.
 * @returns Returns true when the notice should be added.
 */
export function needsPrivacyNotice(items: readonly AgentItem[]): boolean {
  return (
    items.some((item: AgentItem): boolean => item.kind === 'user') &&
    !items.some(
      (item: AgentItem): boolean => item.kind === 'notice' && item.text === LOG_PRIVACY_NOTICE,
    )
  );
}
