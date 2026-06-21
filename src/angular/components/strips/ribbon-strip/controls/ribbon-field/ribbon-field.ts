import {
  ChangeDetectionStrategy,
  Component,
  input,
  InputSignal,
  output,
  OutputEmitterRef,
} from '@angular/core';

/**
 * Represents a labelled select (dropdown) field in the ribbon.
 */
@Component({
  selector: 'app-ribbon-field',
  imports: [],
  templateUrl: './ribbon-field.html',
  styleUrl: './ribbon-field.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RibbonField {
  /**
   * Gets the caption displayed above the select.
   */
  public readonly label: InputSignal<string> = input.required<string>();

  /**
   * Gets the options offered by the select.
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
   * Handles a change on the select, emitting the {@link changed} event.
   *
   * The field is controlled: it shows whatever the parent supplies through {@link value}, not the
   * user's raw pick. After emitting, the select is re-asserted to {@link value} so a pick the parent
   * does not adopt cannot leave the native select stuck on it (the value binding alone cannot correct
   * this, as Angular skips writes it considers unchanged).
   * @param event The DOM change event raised by the underlying select.
   */
  protected onChange(event: Event): void {
    const select: HTMLSelectElement = event.target as HTMLSelectElement;
    this.changed.emit(select.value);
    select.value = this.value() ?? this.options()[0] ?? '';
  }
}
