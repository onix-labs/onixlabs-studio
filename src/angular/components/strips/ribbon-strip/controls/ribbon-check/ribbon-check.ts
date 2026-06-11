import {
  ChangeDetectionStrategy,
  Component,
  input,
  InputSignal,
  output,
  OutputEmitterRef,
} from '@angular/core';

/**
 * Represents a labelled checkbox option in the ribbon.
 */
@Component({
  selector: 'app-ribbon-check',
  imports: [],
  templateUrl: './ribbon-check.html',
  styleUrl: './ribbon-check.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RibbonCheck {
  /**
   * Gets the label displayed beside the checkbox.
   */
  public readonly label: InputSignal<string> = input.required<string>();

  /**
   * Gets a value indicating whether the checkbox is checked.
   */
  public readonly checked: InputSignal<boolean> = input<boolean>(false);

  /**
   * Gets a value indicating whether the checkbox is disabled.
   */
  public readonly disabled: InputSignal<boolean> = input<boolean>(false);

  /**
   * Emits the new checked state when the checkbox is toggled.
   */
  public readonly toggled: OutputEmitterRef<boolean> = output<boolean>();

  /**
   * Handles a change on the checkbox, emitting the {@link toggled} event.
   * @param event The DOM change event raised by the underlying checkbox.
   */
  protected onChange(event: Event): void {
    this.toggled.emit((event.target as HTMLInputElement).checked);
  }
}
