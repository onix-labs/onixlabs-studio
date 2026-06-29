import {
  ChangeDetectionStrategy,
  Component,
  input,
  InputSignal,
  model,
  ModelSignal,
} from '@angular/core';

/**
 * Represents a themed radio control, backed by a native radio for accessibility. The control renders
 * only the dial; callers supply their own label markup and drive selection within a group.
 */
@Component({
  selector: 'app-radio',
  imports: [],
  templateUrl: './radio.html',
  styleUrl: './radio.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Radio {
  /**
   * Gets or sets a value indicating whether the radio is selected.
   */
  public readonly checked: ModelSignal<boolean> = model<boolean>(false);

  /**
   * Gets a value indicating whether the radio is disabled.
   */
  public readonly disabled: InputSignal<boolean> = input<boolean>(false);

  /**
   * Gets the name of the radio group this control belongs to, used for native mutual exclusion.
   */
  public readonly name: InputSignal<string | undefined> = input<string>();

  /**
   * Handles a change on the underlying radio, marking this control as selected.
   * @param event The DOM change event raised by the radio.
   */
  protected onChange(event: Event): void {
    this.checked.set((event.target as HTMLInputElement).checked);
  }
}
