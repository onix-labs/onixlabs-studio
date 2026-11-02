import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  Signal,
  signal,
  WritableSignal,
} from '@angular/core';
import type { AgentConversationSummary } from '@shared/api/agent-conversation-channels';
import { Button } from '@shared/angular/components/forms/button/button';
import { ButtonRow } from '@shared/angular/components/forms/button-row/button-row';
import { Checkbox } from '@shared/angular/components/forms/checkbox/checkbox';
import { Modal } from '@shared/angular/components/modal/modal';
import { ModalContent } from '@shared/angular/components/modal/modal-content';
import { ConversationRetention } from '@shared/angular/services/conversation-retention/conversation-retention';
import { Settings } from '@shared/angular/services/settings/settings';

/**
 * Asks about the conversations Delete Conversations After found due at start-up, when its mode is
 * Ask: Yes deletes them all, No keeps them until the next launch, and Review lists them so the user
 * ticks which go. Mounted once by the shell.
 */
@Component({
  selector: 'app-conversation-retention-prompt',
  imports: [Button, ButtonRow, Checkbox, Modal, ModalContent],
  templateUrl: './conversation-retention-prompt.html',
  styleUrl: './conversation-retention-prompt.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConversationRetentionPrompt {
  /**
   * Holds the retention service, which found the conversations and deletes them.
   */
  private readonly retention: ConversationRetention = inject(ConversationRetention);

  /**
   * Holds the settings store, for the time period the question names.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Gets the conversations awaiting an answer.
   */
  protected readonly due: Signal<readonly AgentConversationSummary[]> = this.retention.due;

  /**
   * Holds a value indicating whether the Review list is showing rather than the question.
   */
  protected readonly reviewing: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds the ids of the conversations unticked in the Review list — those to keep.
   */
  private readonly kept: WritableSignal<ReadonlySet<string>> = signal<ReadonlySet<string>>(
    new Set<string>(),
  );

  /**
   * Gets the number of conversations ticked to go.
   */
  protected readonly tickedCount: Signal<number> = computed(
    (): number => this.due().length - this.kept().size,
  );

  /**
   * Gets the time period the question names, such as "90 days".
   */
  protected readonly period: Signal<string> = computed(
    (): string => `${this.settings.value('ai.deleteConversationsAfterDays')()} days`,
  );

  /**
   * Initializes a new instance of the {@link ConversationRetentionPrompt} class, running the check
   * once the shell has rendered.
   */
  public constructor() {
    afterNextRender((): void => {
      void this.retention.check(Date.now());
    });
  }

  /**
   * Determines whether a conversation is ticked to go.
   * @param id The conversation id.
   * @returns Returns true unless the user unticked it.
   */
  protected isTicked(id: string): boolean {
    return !this.kept().has(id);
  }

  /**
   * Ticks or unticks a conversation in the Review list.
   * @param id The conversation id.
   * @param ticked Whether it goes.
   */
  protected setTicked(id: string, ticked: boolean): void {
    const next: Set<string> = new Set<string>(this.kept());
    if (ticked) {
      next.delete(id);
    } else {
      next.add(id);
    }
    this.kept.set(next);
  }

  /**
   * Formats when a conversation last had a message.
   * @param summary The conversation.
   * @returns Returns the date, in the user's locale.
   */
  protected lastUsed(summary: AgentConversationSummary): string {
    return new Date(summary.updatedAt).toLocaleDateString();
  }

  /**
   * Deletes every due conversation.
   */
  protected deleteAll(): void {
    void this.retention.delete(
      this.due().map((summary: AgentConversationSummary): string => summary.id),
    );
  }

  /**
   * Deletes the conversations ticked in the Review list.
   */
  protected deleteTicked(): void {
    void this.retention.delete(
      this.due()
        .map((summary: AgentConversationSummary): string => summary.id)
        .filter((id: string): boolean => !this.kept().has(id)),
    );
    this.reviewing.set(false);
    this.kept.set(new Set<string>());
  }

  /**
   * Keeps every due conversation for now.
   */
  protected keep(): void {
    this.retention.keep();
    this.reviewing.set(false);
    this.kept.set(new Set<string>());
  }
}
