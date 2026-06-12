import {
  ChangeDetectionStrategy,
  Component,
  input,
  InputSignal,
  model,
  ModelSignal,
} from '@angular/core';

/**
 * Represents a themed boolean checkbox, backed by a native checkbox for accessibility. The control
 * renders only the box; callers supply their own label markup.
 */
@Component({
  selector: 'app-checkbox',
  imports: [],
  templateUrl: './checkbox.html',
  styleUrl: './checkbox.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Checkbox {
  /**
   * Gets or sets a value indicating whether the checkbox is checked.
   */
  public readonly checked: ModelSignal<boolean> = model<boolean>(false);

  /**
   * Gets a value indicating whether the checkbox is disabled.
   */
  public readonly disabled: InputSignal<boolean> = input<boolean>(false);

  /**
   * Handles a change on the underlying checkbox, updating the {@link checked} model.
   * @param event The DOM change event raised by the checkbox.
   */
  protected onChange(event: Event): void {
    this.checked.set((event.target as HTMLInputElement).checked);
  }
}
