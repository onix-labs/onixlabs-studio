import { inject, Service, Signal, signal, WritableSignal } from '@angular/core';
import type { AgentConversationSummary } from '@shared/api/agent-conversation-channels';
import { AgentConversations } from '@shared/angular/services/agent-conversations/agent-conversations';
import { Log } from '@shared/angular/services/log/log';
import { Notifications } from '@shared/angular/services/notifications/notifications';
import { Settings } from '@shared/angular/services/settings/settings';

/**
 * Holds the milliseconds in a day.
 */
const DAY_MS: number = 24 * 60 * 60 * 1000;

/**
 * Carries out Delete Conversations After: once at start-up it finds the saved conversations with no
 * new messages for the chosen time, then deletes them (Automatic) or holds them for the prompt to ask
 * about (Ask), where the user answers Yes, No, or Review and ticks which go.
 */
@Service()
export class ConversationRetention {
  /**
   * Holds the conversation store.
   */
  private readonly store: AgentConversations = inject(AgentConversations);

  /**
   * Holds the settings store.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Holds the notifications, which report an automatic clear-out.
   */
  private readonly notifications: Notifications = inject(Notifications);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the conversations awaiting the user's answer, or none when there is nothing to ask.
   */
  private readonly dueState: WritableSignal<readonly AgentConversationSummary[]> = signal<
    readonly AgentConversationSummary[]
  >([]);

  /**
   * Gets the conversations awaiting the user's answer, oldest first; empty when there is nothing to
   * ask.
   */
  public readonly due: Signal<readonly AgentConversationSummary[]> = this.dueState.asReadonly();

  /**
   * Holds a value indicating whether the check has run, so it runs once per launch.
   */
  private checked: boolean = false;

  /**
   * Finds the conversations due for deletion and deletes them or holds them for the prompt, as the
   * settings say. Runs once per launch; later calls do nothing.
   * @param now The current time, in epoch milliseconds.
   * @returns Returns a promise that resolves once the check is done.
   */
  public async check(now: number): Promise<void> {
    if (this.checked) {
      return;
    }
    this.checked = true;
    const days: number = this.settings.get('ai.deleteConversationsAfterDays');
    if (days <= 0) {
      return;
    }
    const cutoff: number = now - days * DAY_MS;
    const due: readonly AgentConversationSummary[] = (await this.store.listAll())
      .filter((summary: AgentConversationSummary): boolean => summary.updatedAt < cutoff)
      .sort(
        (left: AgentConversationSummary, right: AgentConversationSummary): number =>
          left.updatedAt - right.updatedAt,
      );
    if (due.length === 0) {
      return;
    }
    this.log.info('ConversationRetention', `${due.length} conversation(s) older than ${days} days`);
    if (this.settings.get('ai.deleteConversationsMode') === 'automatic') {
      await this.delete(due.map((summary: AgentConversationSummary): string => summary.id));
      return;
    }
    this.dueState.set(due);
  }

  /**
   * Deletes the given due conversations and closes the question.
   * @param ids The conversations to delete.
   * @returns Returns a promise that resolves once they are deleted.
   */
  public async delete(ids: readonly string[]): Promise<void> {
    this.dueState.set([]);
    if (ids.length === 0) {
      return;
    }
    await this.store.delete(ids);
    this.log.info('ConversationRetention', `Deleted ${ids.length} old conversation(s)`);
    this.notifications.notify({
      severity: 'info',
      title: `Deleted ${ids.length} old ${ids.length === 1 ? 'conversation' : 'conversations'}`,
      detail: `Delete Conversations After is set to ${this.settings.get('ai.deleteConversationsAfterDays')} days.`,
    });
  }

  /**
   * Keeps every due conversation this time; the question returns at the next launch.
   */
  public keep(): void {
    this.log.info('ConversationRetention', 'Old conversations kept for now');
    this.dueState.set([]);
  }
}
