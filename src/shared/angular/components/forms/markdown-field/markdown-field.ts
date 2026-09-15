import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  InputSignal,
  model,
  ModelSignal,
  Signal,
  signal,
  WritableSignal,
} from '@angular/core';
import { Button } from '@shared/angular/components/forms/button/button';
import { MarkdownEditor } from '@shared/angular/components/markdown-editor/markdown-editor';
import { Modal } from '@shared/angular/components/modal/modal';
import { ModalContent } from '@shared/angular/components/modal/modal-content';
import { Icon } from '@shared/angular/icons/icon';

/**
 * Represents a markdown field: the shared markdown editor in its inset presentation, framed as a form
 * control so it sits in a settings row or a form the way a {@link Textarea} does. For text the reader
 * will treat as markdown — a standing prompt, a skill's instructions — where a plain textarea would
 * hide the structure being written.
 *
 * Beneath the frame an Edit button opens the same text in a window of its own, expandable to the
 * screen, as the agent composer's markdown editor does; what is written there is a draft until
 * applied, and Cancel or dismissing the window leaves the field as it was.
 *
 * Exchanges markdown strings. Setting {@link value} to text the editor does not already hold replaces
 * the editor content; edits report through the model as they are made.
 */
@Component({
  selector: 'app-markdown-field',
  imports: [Button, MarkdownEditor, Modal, ModalContent],
  templateUrl: './markdown-field.html',
  styleUrl: './markdown-field.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'group',
    '[attr.aria-label]': 'ariaLabel()',
    '[class.markdown-field--disabled]': 'disabled()',
    '[style.--markdown-field-min-rows]': 'minRows()',
  },
})
export class MarkdownField {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets or sets the markdown text.
   */
  public readonly value: ModelSignal<string> = model<string>('');

  /**
   * Gets the accessible name of the field, which also heads the editing window.
   */
  public readonly ariaLabel: InputSignal<string | undefined> = input<string>();

  /**
   * Gets the number of text rows the field is at least tall enough for; it grows past this with its
   * content.
   */
  public readonly minRows: InputSignal<number> = input<number>(5);

  /**
   * Gets a value indicating whether the field is read-only.
   */
  public readonly disabled: InputSignal<boolean> = input<boolean>(false);

  /**
   * Gets whether the editing window is open.
   */
  protected readonly modalOpen: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Gets the text the window's editor was opened with. Held apart from the live draft so the editor
   * is seeded once per opening rather than rebuilt on every keystroke it reports.
   */
  protected readonly draftSeed: WritableSignal<string> = signal<string>('');

  /**
   * Holds the window's live text, applied to the field on Apply and discarded on Cancel.
   */
  private draft: string = '';

  /**
   * Gets the window's heading: "Edit" and the field's name.
   */
  protected readonly modalTitle: Signal<string> = computed(
    (): string => `Edit ${this.ariaLabel() ?? 'markdown'}`,
  );

  /**
   * Handles an edit in the inline editor, updating the model.
   * @param markdown The editor's markdown after the edit.
   */
  protected onChange(markdown: string): void {
    this.value.set(markdown);
  }

  /**
   * Opens the editing window on the field's current text.
   */
  protected openModal(): void {
    this.draftSeed.set(this.value());
    this.draft = this.value();
    this.modalOpen.set(true);
  }

  /**
   * Records the window's live text.
   * @param markdown The window editor's markdown after the edit.
   */
  protected onDraftChange(markdown: string): void {
    this.draft = markdown;
  }

  /**
   * Applies the window's text to the field and closes the window.
   */
  protected applyModal(): void {
    this.value.set(this.draft);
    this.closeModal();
  }

  /**
   * Closes the window, discarding whatever was written there.
   */
  protected cancelModal(): void {
    this.closeModal();
  }

  /**
   * Closes the window and clears the draft.
   */
  private closeModal(): void {
    this.modalOpen.set(false);
    this.draftSeed.set('');
    this.draft = '';
  }
}
