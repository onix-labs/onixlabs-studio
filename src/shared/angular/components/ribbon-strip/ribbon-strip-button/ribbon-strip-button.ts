import {
  ChangeDetectionStrategy,
  Component,
  input,
  InputSignal,
  output,
  OutputEmitterRef,
} from '@angular/core';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { ButtonTone } from '@shared/angular/components/forms/button/button';
import { Icon } from '@shared/angular/icons/icon';

/**
 * Represents a large command button in the ribbon, rendering an icon above a label.
 */
@Component({
  selector: 'app-ribbon-strip-button',
  imports: [AppIcon],
  templateUrl: './ribbon-strip-button.html',
  styleUrl: './ribbon-strip-button.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RibbonStripButton {
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
   * Gets the clockwise rotation of the icon, in degrees. Defaults to none; used, for example, to tilt
   * the settings gear to match how it reads elsewhere.
   */
  public readonly iconRotation: InputSignal<number> = input<number>(0);

  /**
   * Gets the meaning the button carries, which colours it. Defaults to the accent, matching every
   * other ribbon button; a caller states a state tone (a destructive `danger`) for a command whose
   * meaning should read at a glance. It colours the glyph and label without changing the button's
   * shape, so a toned ribbon button is styled exactly like its neighbours.
   */
  public readonly tone: InputSignal<ButtonTone> = input<ButtonTone>('accent');

  /**
   * Gets a value indicating whether only the icon is shown. The label is kept as the button's
   * accessible name and tooltip, but its text is hidden.
   */
  public readonly iconOnly: InputSignal<boolean> = input<boolean>(false);

  /**
   * Gets a value indicating whether the button is a latching toggle rather than a one-shot action.
   */
  public readonly toggle: InputSignal<boolean> = input<boolean>(false);

  /**
   * Gets a value indicating whether the toggle is currently pressed. Only meaningful when
   * {@link toggle} is set.
   */
  public readonly pressed: InputSignal<boolean> = input<boolean>(false);

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
