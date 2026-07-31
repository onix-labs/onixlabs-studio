import {
  ChangeDetectionStrategy,
  Component,
  input,
  InputSignal,
  output,
  OutputEmitterRef,
} from '@angular/core';

/**
 * Represents a range slider backed by a native range input. The control is controlled — it displays
 * whatever {@link value} supplies and reports changes through {@link valueChange}. An optional
 * {@link trackBackground} paints the track with a caller-supplied CSS image (a gradient), letting the
 * same atom serve a plain value slider and a colour spectrum alike.
 */
@Component({
  selector: 'app-slider',
  imports: [],
  templateUrl: './slider.html',
  styleUrl: './slider.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Slider {
  /**
   * Gets the smallest selectable value.
   */
  public readonly min: InputSignal<number> = input<number>(0);

  /**
   * Gets the largest selectable value.
   */
  public readonly max: InputSignal<number> = input<number>(100);

  /**
   * Gets the increment between selectable values.
   */
  public readonly step: InputSignal<number> = input<number>(1);

  /**
   * Gets the current value.
   */
  public readonly value: InputSignal<number> = input<number>(0);

  /**
   * Gets the accessible name of the slider, for one with no visible label beside it.
   */
  public readonly ariaLabel: InputSignal<string | undefined> = input<string>();

  /**
   * Gets an optional CSS background painted on the track (for example a gradient). When omitted the
   * track uses the default form track colour.
   */
  public readonly trackBackground: InputSignal<string | undefined> = input<string>();

  /**
   * Gets a value indicating whether the slider is disabled.
   */
  public readonly disabled: InputSignal<boolean> = input<boolean>(false);

  /**
   * Emits the new value as the slider moves.
   */
  public readonly valueChange: OutputEmitterRef<number> = output<number>();

  /**
   * Handles input on the underlying range control, reporting the new numeric value.
   * @param event The DOM input event raised by the range control.
   */
  protected onInput(event: Event): void {
    this.valueChange.emit(Number((event.target as HTMLInputElement).value));
  }
}
