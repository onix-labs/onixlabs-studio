import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  Signal,
  untracked,
  WritableSignal,
} from '@angular/core';
import { ForgeCloseReason } from '@shared/api/forge-types';
import { Button } from '@shared/angular/components/forms/button/button';
import { Dropdown, DropdownOption } from '@shared/angular/components/forms/dropdown/dropdown';
import { NumberField } from '@shared/angular/components/forms/number-field/number-field';
import { Modal } from '@shared/angular/components/modal/modal';
import { ModalContent } from '@shared/angular/components/modal/modal-content';
import { ForgeRepository } from '@shared/angular/services/forge-repository/forge-repository';
import { IssueActions, PendingIssueState } from '@shared/angular/services/issues/issue-actions';

/**
 * The reasons in the order GitHub offers them, as the dropdown lists them.
 */
const CLOSE_REASON_OPTIONS: readonly DropdownOption[] = [
  { value: 'completed', label: 'Completed' },
  { value: 'notPlanned', label: 'Not Planned' },
  { value: 'duplicate', label: 'Duplicate' },
];

/**
 * Asks before an issue is closed or reopened on its host (#890).
 *
 * Closing asks why, from a dropdown of the reasons the repository's host records: done, not going to
 * be, or a duplicate of another issue, named by its number in a field shown only for a duplicate. Reopening has no reason to give. Dropped into a
 * template, it draws nothing until {@link IssueActions} has something to ask.
 */
@Component({
  selector: 'app-issue-state-confirm',
  imports: [Button, Dropdown, Modal, ModalContent, NumberField],
  templateUrl: './issue-state-confirm.html',
  styleUrl: './issue-state-confirm.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IssueStateConfirm {
  /**
   * Holds the seam that owns both the question and the answer.
   */
  protected readonly actions: IssueActions = inject(IssueActions);

  /**
   * Holds the forge-backed repository, which says which reasons its host records.
   */
  private readonly forgeRepository: ForgeRepository = inject(ForgeRepository);

  /**
   * Gets the reasons on offer for this repository.
   */
  protected readonly reasons: Signal<readonly DropdownOption[]> = computed(
    (): readonly DropdownOption[] => {
      const allowed: readonly string[] = this.forgeRepository.closeReasons();
      return CLOSE_REASON_OPTIONS.filter((option: DropdownOption): boolean =>
        allowed.includes(option.value),
      );
    },
  );

  /**
   * Holds the reason chosen.
   */
  protected readonly reason: WritableSignal<ForgeCloseReason> =
    signal<ForgeCloseReason>('completed');

  /**
   * Holds the number of the issue this one duplicates, or zero before one is given.
   */
  protected readonly duplicateOf: WritableSignal<number> = signal<number>(0);

  /**
   * Gets whether the answer is complete enough to send: a duplicate needs an original that is not
   * the issue itself.
   */
  protected readonly canClose: Signal<boolean> = computed((): boolean => {
    if (this.reason() !== 'duplicate') {
      return true;
    }
    const original: number = this.duplicateOf();
    return original > 0 && original !== this.actions.pending()?.issue.number;
  });

  /**
   * Initializes a new instance of the {@link IssueStateConfirm} class, starting each question afresh.
   */
  public constructor() {
    effect((): void => {
      const pending: PendingIssueState | null = this.actions.pending();
      untracked((): void => {
        if (pending !== null) {
          this.reason.set('completed');
          this.duplicateOf.set(0);
        }
      });
    });
  }

  /**
   * Takes the reason chosen from the dropdown.
   * @param value The chosen option's value.
   */
  protected chooseReason(value: string): void {
    const chosen: DropdownOption | undefined = this.reasons().find(
      (option: DropdownOption): boolean => option.value === value,
    );
    if (chosen !== undefined) {
      this.reason.set(chosen.value as ForgeCloseReason);
    }
  }

  /**
   * Closes the issue for the reason chosen.
   */
  protected close(): void {
    if (!this.canClose()) {
      return;
    }
    const reason: ForgeCloseReason = this.reason();
    void this.actions.confirm(reason, reason === 'duplicate' ? this.duplicateOf() : undefined);
  }
}
