import {
  ChangeDetectionStrategy,
  Component,
  input,
  InputSignal,
  output,
  OutputEmitterRef,
} from '@angular/core';

/**
 * Defines a selectable swatch in a {@link ColorSwatches} picker.
 */
export interface ColorSwatchOption {
  /**
   * Gets the value applied when the swatch is selected.
   */
  readonly value: string;

  /**
   * Gets the CSS colour the swatch displays (for example a custom property reference).
   */
  readonly color: string;

  /**
   * Gets the accessible label for the swatch. Falls back to {@link value} when omitted.
   */
  readonly label?: string;
}

/**
 * Represents a colour picker rendered as a row of swatches, the active one ringed. Values are
 * exchanged as strings; callers map them to their own union types. The control is controlled — it
 * displays whatever {@link value} supplies and reports picks through {@link valueChange}.
 */
@Component({
  selector: 'app-color-swatches',
  imports: [],
  templateUrl: './color-swatches.html',
  styleUrl: './color-swatches.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ColorSwatches {
  /**
   * Gets the swatches offered by the picker, in display order.
   */
  public readonly options: InputSignal<readonly ColorSwatchOption[]> =
    input.required<readonly ColorSwatchOption[]>();

  /**
   * Gets the selected value.
   */
  public readonly value: InputSignal<string> = input<string>('');

  /**
   * Gets the accessible name applied to the swatch group.
   */
  public readonly ariaLabel: InputSignal<string | undefined> = input<string>();

  /**
   * Emits the newly picked value when the selection changes.
   */
  public readonly valueChange: OutputEmitterRef<string> = output<string>();

  /**
   * Reports the picked value to the parent.
   * @param value The value of the picked swatch.
   */
  protected select(value: string): void {
    this.valueChange.emit(value);
  }
}
