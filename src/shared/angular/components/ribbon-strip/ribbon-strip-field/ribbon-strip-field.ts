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
import { Dropdown, DropdownOption } from '@shared/angular/components/forms/dropdown/dropdown';

/**
 * Represents an option offered by a {@link RibbonStripField}: either a bare string, whose text is both
 * the value and the label, or a full {@link DropdownOption} for a field whose values differ from their
 * labels or whose options are grouped under headings.
 */
export type RibbonFieldOption = string | DropdownOption;

/**
 * Represents a labelled select (dropdown) field in the ribbon, backed by the shared
 * {@link Dropdown} atom so the picker menu and chevron match the rest of the app.
 */
@Component({
  selector: 'app-ribbon-strip-field',
  imports: [Dropdown],
  templateUrl: './ribbon-strip-field.html',
  styleUrl: './ribbon-strip-field.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RibbonStripField {
  /**
   * Gets the caption used as the field's accessible name.
   */
  public readonly label: InputSignal<string> = input.required<string>();

  /**
   * Gets the options offered by the field. Strings and {@link DropdownOption}s may be mixed: a field
   * whose labels are its values passes the former, one with distinct values or group headings the
   * latter.
   */
  public readonly options: InputSignal<readonly RibbonFieldOption[]> =
    input.required<readonly RibbonFieldOption[]>();

  /**
   * Gets the currently selected option.
   */
  public readonly value: InputSignal<string | undefined> = input<string>();

  /**
   * Gets a value indicating whether the field is disabled.
   */
  public readonly disabled: InputSignal<boolean> = input<boolean>(false);

  /**
   * Gets a value indicating whether the select stretches to fill its container width (the default)
   * rather than sizing to its own content.
   */
  public readonly fullWidth: InputSignal<boolean> = input<boolean>(true);

  /**
   * Emits the newly selected option when the selection changes.
   */
  public readonly changed: OutputEmitterRef<string> = output<string>();

  /**
   * Gets the options normalized onto the dropdown's shape: a string option becomes an entry whose value
   * and label are identical, while a {@link DropdownOption} passes through as supplied.
   */
  protected readonly dropdownOptions: Signal<readonly DropdownOption[]> = computed(
    (): readonly DropdownOption[] =>
      this.options().map(
        (option: RibbonFieldOption): DropdownOption =>
          typeof option === 'string' ? { value: option, label: option } : option,
      ),
  );

  /**
   * Gets the value shown by the control, falling back to the first option when none is supplied.
   */
  protected readonly selectedValue: Signal<string> = computed(
    (): string => this.value() ?? this.dropdownOptions()[0]?.value ?? '',
  );
}
