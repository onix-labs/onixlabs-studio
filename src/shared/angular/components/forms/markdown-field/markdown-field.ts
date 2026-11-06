import {
  ChangeDetectionStrategy,
  Component,
  input,
  InputSignal,
  model,
  ModelSignal,
} from '@angular/core';
import { MarkdownEditor } from '@shared/angular/components/markdown-editor/markdown-editor';

/**
 * Represents a markdown field: the shared markdown editor in its inset presentation, framed as a form
 * control so it sits in a settings row or a form the way a {@link Textarea} does. For text the reader
 * will treat as markdown — a standing prompt, a skill's instructions — where a plain textarea would
 * hide the structure being written.
 *
 * Exchanges markdown strings. Setting {@link value} to text the editor does not already hold replaces
 * the editor content; edits report through the model as they are made.
 */
@Component({
  selector: 'app-markdown-field',
  imports: [MarkdownEditor],
  templateUrl: './markdown-field.html',
  styleUrl: './markdown-field.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'group',
    '[attr.aria-label]': 'ariaLabel()',
    '[class.markdown-field--disabled]': 'disabled()',
    '[class.markdown-field--fill]': 'fill()',
    '[style.--markdown-field-min-rows]': 'minRows()',
  },
})
export class MarkdownField {
  /**
   * Gets or sets the markdown text.
   */
  public readonly value: ModelSignal<string> = model<string>('');

  /**
   * Gets the accessible name of the field.
   */
  public readonly ariaLabel: InputSignal<string | undefined> = input<string>();

  /**
   * Gets the number of text rows the field is at least tall enough for; it grows past this with its
   * content.
   */
  public readonly minRows: InputSignal<number> = input<number>(5);

  /**
   * Gets whether the field fills the height its parent gives it rather than growing with its content
   * up to a cap. The parent must give the field a height: a flex column, with the field flexed.
   */
  public readonly fill: InputSignal<boolean> = input<boolean>(false);

  /**
   * Gets a value indicating whether the field is read-only.
   */
  public readonly disabled: InputSignal<boolean> = input<boolean>(false);

  /**
   * Handles an edit in the inline editor, updating the model.
   * @param markdown The editor's markdown after the edit.
   */
  protected onChange(markdown: string): void {
    this.value.set(markdown);
  }
}
