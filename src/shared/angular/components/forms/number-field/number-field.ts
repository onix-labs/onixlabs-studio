import {
  ChangeDetectionStrategy,
  Component,
  input,
  InputSignal,
  model,
  ModelSignal,
} from '@angular/core';

/**
 * Represents a numeric input field that clamps its value to an optional minimum and maximum.
 */
@Component({
  selector: 'app-number-field',
  imports: [],
  templateUrl: './number-field.html',
  styleUrl: './number-field.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.number-field--full]': 'fullWidth()',
    '[class.number-field--no-spinner]': '!spinner()',
  },
})
export class NumberField {
  /**
   * Gets or sets the numeric value.
   */
  public readonly value: ModelSignal<number> = model<number>(0);

  /**
   * Gets the minimum allowed value, or undefined when unbounded.
   */
  public readonly min: InputSignal<number | undefined> = input<number>();

  /**
   * Gets the maximum allowed value, or undefined when unbounded.
   */
  public readonly max: InputSignal<number | undefined> = input<number>();

  /**
   * Gets the step increment of the field.
   */
  public readonly step: InputSignal<number> = input<number>(1);

  /**
   * Gets a value indicating whether the field is disabled.
   */
  public readonly disabled: InputSignal<boolean> = input<boolean>(false);

  /**
   * Gets the hint shown while the field is empty, or undefined for none.
   */
  public readonly placeholder: InputSignal<string | undefined> = input<string>();

  /**
   * Gets the accessible name of the field, or undefined when a surrounding label names it.
   */
  public readonly ariaLabel: InputSignal<string | undefined> = input<string>();

  /**
   * Gets a value indicating whether zero means "nothing entered": shown as an empty field, so the
   * placeholder shows, and reported as zero when the field is cleared. For a field naming something by
   * number, where zero is never a real answer.
   */
  public readonly zeroIsEmpty: InputSignal<boolean> = input<boolean>(false);

  /**
   * Gets a value indicating whether the value is reported as it is typed rather than when the field is
   * left, so a control that depends on it (a button it enables) answers at once. A value outside the
   * bounds is not reported until the field is left, where it is clamped.
   */
  public readonly live: InputSignal<boolean> = input<boolean>(false);

  /**
   * Gets a value indicating whether the field fills its container's width rather than sizing to a
   * few digits.
   */
  public readonly fullWidth: InputSignal<boolean> = input<boolean>(false);

  /**
   * Gets a value indicating whether the up/down stepper is shown. Off for a number that names
   * something (an issue), where stepping to the next one is never what is meant.
   */
  public readonly spinner: InputSignal<boolean> = input<boolean>(true);

  /**
   * Handles typing in the underlying input, reporting the value at once when the field is live and
   * the value is within its bounds.
   * @param event The DOM input event raised by the input.
   */
  protected onInput(event: Event): void {
    if (!this.live()) {
      return;
    }
    const text: string = (event.target as HTMLInputElement).value;
    const raw: number = text.trim().length === 0 ? 0 : Number(text);
    if (!Number.isNaN(raw) && this.clamp(raw) === raw) {
      this.value.set(raw);
    } else if (this.zeroIsEmpty() && raw === 0) {
      this.value.set(0);
    }
  }

  /**
   * Handles a change on the underlying input, clamping the entered value and updating the model.
   * @param event The DOM change event raised by the input.
   */
  protected onChange(event: Event): void {
    const text: string = (event.target as HTMLInputElement).value;
    const raw: number = Number(text);
    if (this.zeroIsEmpty() && (text.trim().length === 0 || raw === 0)) {
      this.value.set(0);
      return;
    }
    this.value.set(this.clamp(Number.isNaN(raw) ? 0 : raw));
  }

  /**
   * Clamps the given value to the configured minimum and maximum.
   * @param value The value to clamp.
   * @returns Returns the clamped value.
   */
  private clamp(value: number): number {
    let result: number = value;
    const min: number | undefined = this.min();
    const max: number | undefined = this.max();
    if (min !== undefined) {
      result = Math.max(min, result);
    }
    if (max !== undefined) {
      result = Math.min(max, result);
    }
    return result;
  }
}
