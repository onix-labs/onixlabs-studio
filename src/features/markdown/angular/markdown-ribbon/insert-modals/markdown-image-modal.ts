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
import { FormModal } from './form-modal';
import { FileSystem } from '@shared/angular/services/file-system/file-system';
import { Log } from '@shared/angular/services/log/log';

/**
 * Describes an image to insert: the source URL or path and its alternative text.
 */
export interface ImageInsert {
  /**
   * Gets the image source (a URL or an absolute file path).
   */
  readonly url: string;

  /**
   * Gets the image's alternative text.
   */
  readonly alt: string;
}

/**
 * Prompts for an image's source (typed URL or a file chosen with the native picker) and alt text,
 * then emits the values to insert. Hosted by the markdown ribbon's Insert group.
 */
@Component({
  selector: 'app-markdown-image-modal',
  imports: [FormModal],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './insert-modal.scss',
  template: `
    <app-form-modal
      [open]="open()"
      heading="Insert Image"
      [width]="30"
      [canSubmit]="valid()"
      (confirmed)="confirm()"
      (cancelled)="cancel()"
    >
      <div class="insert-modal__row">
        <div class="insert-modal__field">
          <label class="insert-modal__label" for="image-url">URL or file</label>
          <input
            #urlInput
            id="image-url"
            class="insert-modal__input"
            type="text"
            placeholder="https://example.com/image.png"
            [value]="url()"
            (input)="url.set(urlInput.value)"
          />
        </div>
        <button type="button" class="insert-modal__button" (click)="browse()">Browse…</button>
      </div>

      <div class="insert-modal__field">
        <label class="insert-modal__label" for="image-alt">Alt text</label>
        <input
          #altInput
          id="image-alt"
          class="insert-modal__input"
          type="text"
          placeholder="Describe the image"
          [value]="alt()"
          (input)="alt.set(altInput.value)"
        />
      </div>
    </app-form-modal>
  `,
})
export class MarkdownImageModal {
  /**
   * Holds the file client used to show the native image picker.
   */
  private readonly fileSystem: FileSystem = inject(FileSystem);

  /**
   * Holds the structured logging client for the insert modal's confirmation and file picking.
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
   * Emitted with the image to insert when the user confirms.
   */
  public readonly submitted: OutputEmitterRef<ImageInsert> = output<ImageInsert>();

  /**
   * Holds the image source field value.
   */
  protected readonly url: WritableSignal<string> = signal<string>('');

  /**
   * Holds the alt-text field value.
   */
  protected readonly alt: WritableSignal<string> = signal<string>('');

  /**
   * Gets a value indicating whether the form can be submitted (a source is present).
   */
  protected readonly valid: Signal<boolean> = computed((): boolean => this.url().trim().length > 0);

  /**
   * Opens the native image picker and, when a file is chosen, fills the source field with its path.
   */
  protected async browse(): Promise<void> {
    const path: string | null = await this.fileSystem.pickImage();
    if (path !== null && path.length > 0) {
      this.log.debug('markdown.insert', 'Image picked from file system', { path });
      this.url.set(path);
    }
  }

  /**
   * Confirms the dialog, emitting the image and resetting the fields.
   */
  protected confirm(): void {
    if (!this.valid()) {
      return;
    }
    this.log.debug('markdown.insert', 'Image modal confirmed');
    this.submitted.emit({ url: this.url().trim(), alt: this.alt().trim() });
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
    this.url.set('');
    this.alt.set('');
  }
}
