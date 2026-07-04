import {
  ChangeDetectionStrategy,
  Component,
  input,
  InputSignal,
  output,
  OutputEmitterRef,
} from '@angular/core';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Icon } from '@shared/angular/icons/icon';

/**
 * Defines a selectable option in a {@link ButtonGroup}.
 */
export interface ButtonGroupOption {
  /**
   * Gets the value applied when the option is selected.
   */
  readonly value: string;

  /**
   * Gets the label shown for the option.
   */
  readonly label: string;

  /**
   * Gets the optional icon shown before the label.
   */
  readonly icon?: Icon;
}

/**
 * Represents a segmented control: mutually exclusive options joined into a single inset track. Values
 * are exchanged as strings; callers map them to their own union types. The control is controlled — it
 * displays whatever {@link value} supplies and reports picks through {@link valueChange}.
 */
@Component({
  selector: 'app-button-group',
  imports: [AppIcon],
  templateUrl: './button-group.html',
  styleUrl: './button-group.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ButtonGroup {
  /**
   * Gets the options offered by the control.
   */
  public readonly options: InputSignal<readonly ButtonGroupOption[]> =
    input.required<readonly ButtonGroupOption[]>();

  /**
   * Gets the selected value.
   */
  public readonly value: InputSignal<string> = input<string>('');

  /**
   * Gets the accessible name applied to the option group.
   */
  public readonly ariaLabel: InputSignal<string | undefined> = input<string>();

  /**
   * Emits the newly picked value when the selection changes.
   */
  public readonly valueChange: OutputEmitterRef<string> = output<string>();

  /**
   * Reports the picked value to the parent.
   * @param value The value of the picked option.
   */
  protected select(value: string): void {
    this.valueChange.emit(value);
  }
}
