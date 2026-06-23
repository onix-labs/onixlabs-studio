import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  InputSignal,
  output,
  OutputEmitterRef,
  Signal,
} from '@angular/core';
import { Dropdown, DropdownOption } from '../../../../forms/dropdown/dropdown';

/**
 * Represents a labelled select (dropdown) field in the ribbon, backed by the shared
 * {@link Dropdown} atom so the picker menu and chevron match the rest of the app.
 */
@Component({
  selector: 'app-ribbon-field',
  imports: [Dropdown],
  templateUrl: './ribbon-field.html',
  styleUrl: './ribbon-field.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RibbonField {
  /**
   * Gets the caption used as the field's accessible name.
   */
  public readonly label: InputSignal<string> = input.required<string>();

  /**
   * Gets the options offered by the field.
   */
  public readonly options: InputSignal<readonly string[]> = input.required<readonly string[]>();

  /**
   * Gets the currently selected option.
   */
  public readonly value: InputSignal<string | undefined> = input<string>();

  /**
   * Gets a value indicating whether the field is disabled.
   */
  public readonly disabled: InputSignal<boolean> = input<boolean>(false);

  /**
   * Emits the newly selected option when the selection changes.
   */
  public readonly changed: OutputEmitterRef<string> = output<string>();

  /**
   * Gets the string options projected onto the dropdown's value/label shape (the two are identical).
   */
  protected readonly dropdownOptions: Signal<readonly DropdownOption[]> = computed(
    (): readonly DropdownOption[] => this.options().map((option: string) => ({ value: option, label: option })),
  );

  /**
   * Gets the value shown by the control, falling back to the first option when none is supplied.
   */
  protected readonly selectedValue: Signal<string> = computed(
    (): string => this.value() ?? this.options()[0] ?? '',
  );
}
