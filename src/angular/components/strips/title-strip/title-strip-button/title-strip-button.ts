import {
  ChangeDetectionStrategy,
  Component,
  input,
  InputSignal,
  output,
  OutputEmitterRef,
} from '@angular/core';
import { AppIcon } from '../../../shared/icon/app-icon';
import { Icon } from '../../../../icons/icon';

/**
 * Represents an icon button in the title strip.
 */
@Component({
  selector: 'app-title-strip-button',
  imports: [AppIcon],
  templateUrl: './title-strip-button.html',
  styleUrl: './title-strip-button.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TitleStripButton {
  /**
   * Gets the icon to display.
   */
  public readonly icon: InputSignal<Icon> = input.required<Icon>();

  /**
   * Gets the accessible label and tooltip for the icon-only button.
   */
  public readonly label: InputSignal<string | undefined> = input<string>();

  /**
   * Gets the clockwise rotation of the icon in degrees.
   */
  public readonly rotation: InputSignal<number> = input<number>(0);

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
