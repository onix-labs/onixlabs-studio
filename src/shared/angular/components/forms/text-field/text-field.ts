import {
  ChangeDetectionStrategy,
  Component,
  input,
  InputSignal,
  model,
  ModelSignal,
} from '@angular/core';

/**
 * Represents a single-line text input field.
 */
@Component({
  selector: 'app-text-field',
  imports: [],
  templateUrl: './text-field.html',
  styleUrl: './text-field.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TextField {
  /**
   * Gets or sets the text value.
   */
  public readonly value: ModelSignal<string> = model<string>('');

  /**
   * Gets the placeholder shown when the field is empty.
   */
  public readonly placeholder: InputSignal<string> = input<string>('');

  /**
   * Gets a value indicating whether the field is disabled.
   */
  public readonly disabled: InputSignal<boolean> = input<boolean>(false);

  /**
   * Handles input on the underlying control, updating the {@link value} model on each keystroke.
   * @param event The DOM input event raised by the input.
   */
  protected onInput(event: Event): void {
    this.value.set((event.target as HTMLInputElement).value);
  }
}
