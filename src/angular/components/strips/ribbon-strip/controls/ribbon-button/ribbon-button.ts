import {
  ChangeDetectionStrategy,
  Component,
  input,
  InputSignal,
  output,
  OutputEmitterRef,
} from '@angular/core';
import { AppIcon } from '../../../../shared/icon/app-icon';
import { Icon } from '../../../../../icons/icon';

/**
 * Represents a large command button in the ribbon, rendering an icon above a label.
 */
@Component({
  selector: 'app-ribbon-button',
  imports: [AppIcon],
  templateUrl: './ribbon-button.html',
  styleUrl: './ribbon-button.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RibbonButton {
  /**
   * Gets the icon to display.
   */
  public readonly icon: InputSignal<Icon> = input.required<Icon>();

  /**
   * Gets the label displayed beneath the icon.
   */
  public readonly label: InputSignal<string> = input.required<string>();

  /**
   * Gets a value indicating whether the button is disabled.
   */
  public readonly disabled: InputSignal<boolean> = input<boolean>(false);

  /**
   * Emits when the button is activated.
   */
  public readonly action: OutputEmitterRef<void> = output<void>();

  /**
   * Handles a click on the button, emitting the {@link action} event.
   */
  protected onClick(): void {
    this.action.emit();
  }
}
