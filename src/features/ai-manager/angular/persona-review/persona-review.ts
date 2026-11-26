import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import type { PersonaEntry } from '@shared/api/persona-channels';
import type { PersonaChange } from '@shared/api/persona-learning-protocol';
import { Button } from '@shared/angular/components/forms/button/button';
import { ButtonRow } from '@shared/angular/components/forms/button-row/button-row';
import { Chip, type ChipTone } from '@shared/angular/components/chip/chip';
import { Modal } from '@shared/angular/components/modal/modal';
import { ModalContent } from '@shared/angular/components/modal/modal-content';
import { Log } from '@shared/angular/services/log/log';
import { PersonaLearning } from '@shared/angular/services/persona/persona-learning';

/**
 * One waiting change as the review shows it.
 */
interface ReviewRow {
  readonly id: string;
  readonly label: string;
  readonly tone: ChipTone;
  readonly name: string;
  readonly before: string | null;
  readonly after: string | null;
  readonly reason: string;
}

/**
 * The review of learned changes (#1517): each waiting change shown as added, changed or removed — what
 * the entry said and what it would say — with Accept or Reject on each, and Accept All. A change the
 * user does not decide on simply waits for the next review.
 */
@Component({
  selector: 'app-persona-review',
  imports: [Button, ButtonRow, Chip, Modal, ModalContent],
  templateUrl: './persona-review.html',
  styleUrl: './persona-review.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PersonaReview {
  /**
   * Holds persona learning.
   */
  protected readonly learning: PersonaLearning = inject(PersonaLearning);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Gets the waiting changes, oldest first.
   */
  protected readonly rows: Signal<readonly ReviewRow[]> = computed((): readonly ReviewRow[] =>
    this.learning.state().pending.map((change: PersonaChange): ReviewRow => ({
      id: change.id,
      label: change.kind === 'add' ? 'Added' : change.kind === 'remove' ? 'Removed' : 'Changed',
      tone: change.kind === 'add' ? 'success' : change.kind === 'remove' ? 'danger' : 'info',
      name: (change.after ?? change.before)?.name ?? change.entryId,
      before: change.before === null ? null : describe(change.before),
      after: change.after === null ? null : describe(change.after),
      reason: change.reason,
    })),
  );

  /**
   * Accepts one change.
   * @param id The change.
   * @returns Resolves once applied.
   */
  protected async accept(id: string): Promise<void> {
    await this.learning.review([id], []);
    await this.closeWhenDone();
  }

  /**
   * Rejects one change.
   * @param id The change.
   * @returns Resolves once dropped.
   */
  protected async reject(id: string): Promise<void> {
    await this.learning.review([], [id]);
    await this.closeWhenDone();
  }

  /**
   * Accepts every waiting change.
   * @returns Resolves once applied.
   */
  protected async acceptAll(): Promise<void> {
    const ids: readonly string[] = this.rows().map((row: ReviewRow): string => row.id);
    const applied: number = await this.learning.review(ids, []);
    this.log.info('aiManager.persona', `Accepted ${applied} learned change(s)`);
    this.learning.closeReview();
  }

  /**
   * Closes the review, leaving what was not decided to wait.
   */
  protected close(): void {
    this.learning.closeReview();
  }

  /**
   * Closes the review once nothing waits.
   * @returns Resolves once the learning records are current.
   */
  private async closeWhenDone(): Promise<void> {
    await this.learning.refresh();
    if (this.learning.state().pending.length === 0) {
      this.learning.closeReview();
    }
  }
}

/**
 * Describes an entry's state for the review: what it says, its reason and where it lives.
 * @param entry The entry.
 * @returns Returns the description.
 */
function describe(entry: PersonaEntry): string {
  const parts: string[] = [entry.text.trim()];
  if (entry.why.trim().length > 0) {
    parts.push(`Why: ${entry.why.trim()}`);
  }
  const where: string = entry.layer === 'core' ? 'Core' : 'Memory';
  parts.push(
    entry.tags.length === 0
      ? where
      : `${where} · ${entry.tags.map((tag: string): string => `#${tag}`).join(' ')}`,
  );
  return parts.join('\n');
}
