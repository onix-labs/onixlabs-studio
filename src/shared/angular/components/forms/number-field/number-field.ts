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
   * Handles a change on the underlying input, clamping the entered value and updating the model.
   * @param event The DOM change event raised by the input.
   */
  protected onChange(event: Event): void {
    const raw: number = Number((event.target as HTMLInputElement).value);
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
