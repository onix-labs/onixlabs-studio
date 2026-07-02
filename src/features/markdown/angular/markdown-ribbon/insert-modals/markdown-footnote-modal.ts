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
import { Modal } from '@shared/angular/components/modal/modal';

/**
 * Describes a footnote to insert: an optional reference label and the footnote's content.
 */
export interface FootnoteInsert {
  /**
   * Gets the reference label. When empty a label is generated from the content.
   */
  readonly label: string;

  /**
   * Gets the footnote content shown in the definition.
   */
  readonly content: string;
}

/**
 * Prompts for a footnote's reference label and content, then emits the values to insert. The
 * reference is placed at the cursor and the definition is appended to the document. Hosted by the
 * markdown ribbon's Insert group.
 */
@Component({
  selector: 'app-markdown-footnote-modal',
  imports: [Modal],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './insert-modal.scss',
  template: `
    <app-modal [open]="open()" [width]="30" ariaLabel="Insert Footnote" (dismiss)="cancel()">
      <h2 class="insert-modal__title">Insert Footnote</h2>

      <div class="insert-modal__field">
        <label class="insert-modal__label" for="footnote-label">Reference (optional)</label>
        <input
          #labelInput
          id="footnote-label"
          class="insert-modal__input"
          type="text"
          placeholder="e.g. source"
          [value]="label()"
          (input)="label.set(labelInput.value)"
        />
      </div>

      <div class="insert-modal__field">
        <label class="insert-modal__label" for="footnote-content">Footnote content</label>
        <textarea
          #contentInput
          id="footnote-content"
          class="insert-modal__textarea"
          placeholder="The footnote text…"
          [value]="content()"
          (input)="content.set(contentInput.value)"
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
export class MarkdownFootnoteModal {
  /**
   * Gets a value indicating whether the modal is open.
   */
  public readonly open: InputSignal<boolean> = input.required<boolean>();

  /**
   * Emitted when the modal is dismissed without inserting.
   */
  public readonly closed: OutputEmitterRef<void> = output<void>();

  /**
   * Emitted with the footnote to insert when the user confirms.
   */
  public readonly submitted: OutputEmitterRef<FootnoteInsert> = output<FootnoteInsert>();

  /**
   * Holds the reference-label field value.
   */
  protected readonly label: WritableSignal<string> = signal<string>('');

  /**
   * Holds the footnote-content field value.
   */
  protected readonly content: WritableSignal<string> = signal<string>('');

  /**
   * Gets a value indicating whether the form can be submitted (content is present).
   */
  protected readonly valid: Signal<boolean> = computed(
    (): boolean => this.content().trim().length > 0,
  );

  /**
   * Confirms the dialog, emitting the footnote and resetting the fields.
   */
  protected confirm(): void {
    if (!this.valid()) {
      return;
    }
    this.submitted.emit({ label: this.label().trim(), content: this.content().trim() });
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
    this.label.set('');
    this.content.set('');
  }
}
