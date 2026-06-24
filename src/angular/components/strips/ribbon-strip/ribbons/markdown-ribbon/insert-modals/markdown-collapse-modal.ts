import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  InputSignal,
  output,
  OutputEmitterRef,
  signal,
  Signal,
  WritableSignal,
} from '@angular/core';
import { Modal } from '../../../../../shared/modal/modal';

/**
 * Describes a collapsible (details/summary) block to insert: its summary heading and optional body.
 */
export interface CollapseInsert {
  /**
   * Gets the summary heading shown on the collapsed block.
   */
  readonly summary: string;

  /**
   * Gets the optional body revealed when the block is expanded.
   */
  readonly body: string;
}

/**
 * Prompts for a collapsible block's summary and optional body, then emits the values to insert.
 * Hosted by the markdown ribbon's Insert group.
 */
@Component({
  selector: 'app-markdown-collapse-modal',
  imports: [Modal],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './insert-modal.scss',
  template: `
    <app-modal [open]="open()" [width]="30" ariaLabel="Insert Collapsible Block" (dismiss)="cancel()">
      <h2 class="insert-modal__title">Insert Collapsible Block</h2>

      <div class="insert-modal__field">
        <label class="insert-modal__label" for="collapse-summary">Summary</label>
        <input
          #summaryInput
          id="collapse-summary"
          class="insert-modal__input"
          type="text"
          placeholder="Click to expand"
          [value]="summary()"
          (input)="summary.set(summaryInput.value)"
        />
      </div>

      <div class="insert-modal__field">
        <label class="insert-modal__label" for="collapse-body">Body (optional)</label>
        <textarea
          #bodyInput
          id="collapse-body"
          class="insert-modal__textarea"
          placeholder="Hidden content…"
          [value]="body()"
          (input)="body.set(bodyInput.value)"
        ></textarea>
      </div>

      <div class="insert-modal__actions">
        <button type="button" class="insert-modal__button" (click)="cancel()">Cancel</button>
        <button
          type="button"
          class="insert-modal__button insert-modal__button--primary"
          [disabled]="!valid()"
          (click)="confirm()"
        >
          Insert
        </button>
      </div>
    </app-modal>
  `,
})
export class MarkdownCollapseModal {
  /**
   * Gets a value indicating whether the modal is open.
   */
  public readonly open: InputSignal<boolean> = input.required<boolean>();

  /**
   * Emitted when the modal is dismissed without inserting.
   */
  public readonly closed: OutputEmitterRef<void> = output<void>();

  /**
   * Emitted with the collapsible block to insert when the user confirms.
   */
  public readonly submitted: OutputEmitterRef<CollapseInsert> = output<CollapseInsert>();

  /**
   * Holds the summary field value.
   */
  protected readonly summary: WritableSignal<string> = signal<string>('');

  /**
   * Holds the body field value.
   */
  protected readonly body: WritableSignal<string> = signal<string>('');

  /**
   * Gets a value indicating whether the form can be submitted (a summary is present).
   */
  protected readonly valid: Signal<boolean> = computed(
    (): boolean => this.summary().trim().length > 0,
  );

  /**
   * Confirms the dialog, emitting the block and resetting the fields.
   */
  protected confirm(): void {
    if (!this.valid()) {
      return;
    }
    this.submitted.emit({ summary: this.summary().trim(), body: this.body().trim() });
    this.reset();
    this.closed.emit();
  }

  /**
   * Cancels the dialog, resetting the fields.
   */
  protected cancel(): void {
    this.reset();
    this.closed.emit();
  }

  /**
   * Clears the fields so the next open starts fresh.
   */
  private reset(): void {
    this.summary.set('');
    this.body.set('');
  }
}
