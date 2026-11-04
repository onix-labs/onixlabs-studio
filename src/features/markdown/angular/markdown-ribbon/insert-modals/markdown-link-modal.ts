import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  InputSignal,
  output,
  OutputEmitterRef,
  signal,
  Signal,
  WritableSignal,
} from '@angular/core';
import { TextField } from '@shared/angular/components/forms/text-field/text-field';
import { Log } from '@shared/angular/services/log/log';
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
  imports: [FormModal, TextField],
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
        <app-text-field variant="floating" label="Text" placeholder="Link text" [(value)]="text" />
      </div>

      <div class="insert-modal__field">
        <app-text-field
          variant="floating"
          label="URL"
          placeholder="https://example.com"
          [(value)]="url"
        />
      </div>
    </app-form-modal>
  `,
})
export class MarkdownLinkModal {
  /**
   * Holds the structured logging client for the insert modal's confirmation.
   */
  private readonly log: Log = inject(Log);

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
    this.log.debug('markdown.insert', 'Link modal confirmed');
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
