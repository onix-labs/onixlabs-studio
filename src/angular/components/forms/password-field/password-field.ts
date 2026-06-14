import {
  ChangeDetectionStrategy,
  Component,
  input,
  InputSignal,
  model,
  ModelSignal,
} from '@angular/core';

/**
 * Represents a single-line masked secret input (e.g. an API key). It mirrors {@link TextField} but
 * renders a password input so the value is not shown on screen.
 */
@Component({
  selector: 'app-password-field',
  imports: [],
  templateUrl: './password-field.html',
  styleUrl: './password-field.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PasswordField {
  /**
   * Gets or sets the secret value.
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
