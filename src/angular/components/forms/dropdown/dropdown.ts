import {
  ChangeDetectionStrategy,
  Component,
  input,
  InputSignal,
  model,
  ModelSignal,
} from '@angular/core';

/**
 * Defines a selectable option in a {@link Dropdown}.
 */
export interface DropdownOption {
  /**
   * Gets the value applied when the option is selected.
   */
  readonly value: string;

  /**
   * Gets the label shown for the option.
   */
  readonly label: string;
}

/**
 * Represents a single-select dropdown, backed by a native select for accessibility. Values are
 * exchanged as strings; callers map them to their own union types.
 */
@Component({
  selector: 'app-dropdown',
  imports: [],
  templateUrl: './dropdown.html',
  styleUrl: './dropdown.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Dropdown {
  /**
   * Gets the options offered by the dropdown.
   */
  public readonly options: InputSignal<readonly DropdownOption[]> =
    input.required<readonly DropdownOption[]>();

  /**
   * Gets or sets the selected value.
   */
  public readonly value: ModelSignal<string> = model<string>('');

  /**
   * Gets a value indicating whether the dropdown is disabled.
   */
  public readonly disabled: InputSignal<boolean> = input<boolean>(false);

  /**
   * Handles a change on the underlying select, updating the {@link value} model.
   * @param event The DOM change event raised by the select.
   */
  protected onChange(event: Event): void {
    this.value.set((event.target as HTMLSelectElement).value);
  }
}
