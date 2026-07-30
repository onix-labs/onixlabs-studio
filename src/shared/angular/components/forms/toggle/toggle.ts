import {
  ChangeDetectionStrategy,
  Component,
  input,
  InputSignal,
  model,
  ModelSignal,
} from '@angular/core';

/**
 * Represents a switch-style boolean toggle, backed by a native checkbox for accessibility.
 */
@Component({
  selector: 'app-toggle',
  imports: [],
  templateUrl: './toggle.html',
  styleUrl: './toggle.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Toggle {
  /**
   * Gets or sets a value indicating whether the toggle is on.
   */
  public readonly checked: ModelSignal<boolean> = model<boolean>(false);

  /**
   * Gets the accessible name of the toggle, for one with no visible label beside it.
   */
  public readonly ariaLabel: InputSignal<string | undefined> = input<string>();

  /**
   * Gets a value indicating whether the toggle is disabled.
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
