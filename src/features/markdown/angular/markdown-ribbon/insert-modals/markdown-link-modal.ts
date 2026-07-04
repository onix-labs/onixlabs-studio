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
import { FormModal } from './form-modal';

/**
 * Describes a link to insert: the visible text and the destination URL.
 */
export interface LinkInsert {
  /**
   * Gets the visible link text. When empty the URL is shown as the text.
   */
  readonly text: string;

  /**
   * Gets the destination URL.
   */
  readonly url: string;
}

/**
 * Prompts for a link's text and URL, then emits the values to insert. Hosted by the markdown ribbon's
 * Insert group.
 */
@Component({
  selector: 'app-markdown-link-modal',
  imports: [FormModal],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './insert-modal.scss',
  template: `
    <app-form-modal
      [open]="open()"
      heading="Insert Link"
      [width]="28"
      [canSubmit]="valid()"
      (confirmed)="confirm()"
      (cancelled)="cancel()"
    >
      <div class="insert-modal__field">
        <label class="insert-modal__label" for="link-text">Text</label>
        <input
          #textInput
          id="link-text"
          class="insert-modal__input"
          type="text"
          placeholder="Link text"
          [value]="text()"
          (input)="text.set(textInput.value)"
        />
      </div>

      <div class="insert-modal__field">
        <label class="insert-modal__label" for="link-url">URL</label>
        <input
          #urlInput
          id="link-url"
          class="insert-modal__input"
          type="text"
          placeholder="https://example.com"
          [value]="url()"
          (input)="url.set(urlInput.value)"
        />
      </div>
    </app-form-modal>
  `,
})
export class MarkdownLinkModal {
  /**
   * Gets a value indicating whether the modal is open.
   */
  public readonly open: InputSignal<boolean> = input.required<boolean>();

  /**
   * Emitted when the modal is dismissed without inserting.
   */
  public readonly closed: OutputEmitterRef<void> = output<void>();

  /**
   * Emitted with the link to insert when the user confirms.
   */
  public readonly submitted: OutputEmitterRef<LinkInsert> = output<LinkInsert>();

  /**
   * Holds the link text field value.
   */
  protected readonly text: WritableSignal<string> = signal<string>('');

  /**
   * Holds the link URL field value.
   */
  protected readonly url: WritableSignal<string> = signal<string>('');

  /**
   * Gets a value indicating whether the form can be submitted (a URL is present).
   */
  protected readonly valid: Signal<boolean> = computed((): boolean => this.url().trim().length > 0);

  /**
   * Confirms the dialog, emitting the link and resetting the fields.
   */
  protected confirm(): void {
    if (!this.valid()) {
      return;
    }
    this.submitted.emit({ text: this.text().trim(), url: this.url().trim() });
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
    this.text.set('');
    this.url.set('');
  }
}
