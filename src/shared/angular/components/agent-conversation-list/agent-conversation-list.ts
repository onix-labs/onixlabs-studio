import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  Signal,
  WritableSignal,
} from '@angular/core';
import { AgentConversationSummary } from '@shared/api/agent-conversation-channels';
import { AgentConversation } from '@shared/angular/services/agent-conversation/agent-conversation';
import { Icon } from '@shared/angular/icons/icon';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Checkbox } from '@shared/angular/components/forms/checkbox/checkbox';
import { ListRow, ListView } from '@shared/angular/components/list-view/list-view';
import { Modal } from '@shared/angular/components/modal/modal';

/**
 * Lists the persisted conversations of the host's {@link AgentConversation}, newest first, through
 * the shared {@link ListView}. Clicking a conversation rehydrates it; each row carries a checkbox,
 * and checking one or more reveals a Delete action that confirms before deleting. It is a pure list
 * with no chrome of its own — the host (a tool panel or a docked strip) supplies the surface and
 * title — and drives everything through the injected {@link AgentConversation}, so it stays in step
 * with the conversation the chat shows.
 */
@Component({
  selector: 'app-agent-conversation-list',
  imports: [AppIcon, Checkbox, ListView, Modal],
  templateUrl: './agent-conversation-list.html',
  styleUrl: './agent-conversation-list.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AgentConversationList {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the conversation whose stored history this lists and drives.
   */
  private readonly conversation: AgentConversation = inject(AgentConversation);

  /**
   * Gets the stored summaries for the current context, newest first.
   */
  protected readonly summaries: Signal<readonly AgentConversationSummary[]> =
    this.conversation.summaries;

  /**
   * Gets the id of the conversation currently open, highlighted in the list (or null).
   */
  protected readonly activeId: Signal<string | null> = this.conversation.currentId;

  /**
   * Gets the summaries mapped to list rows for the shared {@link ListView}.
   */
  protected readonly rows: Signal<readonly ListRow[]> = computed((): readonly ListRow[] =>
    this.summaries().map(
      (summary: AgentConversationSummary): ListRow => ({ id: summary.id, data: summary }),
    ),
  );

  /**
   * Holds the ids the user has checked for deletion.
   */
  protected readonly checked: WritableSignal<ReadonlySet<string>> = signal<ReadonlySet<string>>(
    new Set<string>(),
  );

  /**
   * Holds whether the delete-confirmation modal is open.
   */
  protected readonly confirmOpen: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Gets the number of conversations checked for deletion.
   */
  protected readonly checkedCount: Signal<number> = computed((): number => this.checked().size);

  /**
   * Gets a value indicating whether any conversation is checked (so the Delete action is shown).
   */
  protected readonly hasChecked: Signal<boolean> = computed((): boolean => this.checkedCount() > 0);

  /**
   * Gets whether a conversation is checked.
   * @param id The conversation id.
   * @returns Returns true when checked.
   */
  protected isChecked(id: string): boolean {
    return this.checked().has(id);
  }

  /**
   * Toggles a conversation's checked state.
   * @param id The conversation id.
   * @param checked Whether it is now checked.
   */
  protected onToggle(id: string, checked: boolean): void {
    const next: Set<string> = new Set<string>(this.checked());
    if (checked) {
      next.add(id);
    } else {
      next.delete(id);
    }
    this.checked.set(next);
  }

  /**
   * Unwraps a list row's conversation-summary payload.
   * @param row The list row.
   * @returns Returns the summary.
   */
  protected summaryOf(row: ListRow): AgentConversationSummary {
    return row.data as AgentConversationSummary;
  }

  /**
   * Rehydrates the clicked row's conversation into the session.
   * @param row The clicked list row.
   */
  protected onRowClick(row: ListRow): void {
    void this.conversation.open(row.id);
  }

  /**
   * Opens the delete-confirmation modal.
   */
  protected onRequestDelete(): void {
    if (this.hasChecked()) {
      this.confirmOpen.set(true);
    }
  }

  /**
   * Closes the delete-confirmation modal without deleting.
   */
  protected onCancelDelete(): void {
    this.confirmOpen.set(false);
  }

  /**
   * Deletes the checked conversations through the conversation service, then clears the selection.
   */
  protected async onConfirmDelete(): Promise<void> {
    const ids: readonly string[] = [...this.checked()];
    this.confirmOpen.set(false);
    if (ids.length === 0) {
      return;
    }
    await this.conversation.delete(ids);
    this.checked.set(new Set<string>());
  }

  /**
   * Formats a timestamp for display in a row's meta line.
   * @param timestamp The epoch-millisecond timestamp.
   * @returns Returns a short local date-time string.
   */
  protected formatWhen(timestamp: number): string {
    return new Date(timestamp).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  }
}
