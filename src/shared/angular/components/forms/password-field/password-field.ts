import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  InputSignal,
  model,
  ModelSignal,
  Signal,
} from '@angular/core';

/**
 * Holds the next id for a field's control, so its floating label can name it.
 */
let nextFieldId: number = 0;

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
  host: {
    '[class.password-field--floating]': 'label() !== undefined',
  },
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
   * Gets the floating label, which draws the field as tall as a floating text field with the label
   * resting in the box until it has focus or a value, or undefined for the plain field.
   */
  public readonly label: InputSignal<string | undefined> = input<string>();

  /**
   * Gets the id tying the control to its floating label.
   */
  protected readonly controlId: string = `password-field-${String(nextFieldId++)}`;

  /**
   * Gets the placeholder the control carries. A floating field needs one even when none is given:
   * whether it is showing is how the stylesheet tells an empty field from a filled one.
   */
  protected readonly shownPlaceholder: Signal<string> = computed((): string =>
    this.label() !== undefined && this.placeholder() === '' ? ' ' : this.placeholder(),
  );

  /**
   * Handles input on the underlying control, updating the {@link value} model on each keystroke.
   * @param event The DOM input event raised by the input.
   */
  protected onInput(event: Event): void {
    this.value.set((event.target as HTMLInputElement).value);
  }
}
