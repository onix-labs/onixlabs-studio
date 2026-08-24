import {
  ChangeDetectionStrategy,
  Component,
  input,
  InputSignal,
  output,
  OutputEmitterRef,
} from '@angular/core';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { TooltipTrigger } from '@shared/angular/components/tooltip/tooltip-trigger';
import { Icon } from '@shared/angular/icons/icon';

/**
 * Represents a small command button in the ribbon, rendering an icon beside a label. Three small
 * buttons stack to the height of a single large {@link RibbonStripButton}. When {@link toggle} is set
 * the button behaves as a latching toggle, reflecting its {@link pressed} state.
 */
@Component({
  selector: 'app-ribbon-strip-button-small',
  imports: [AppIcon, TooltipTrigger],
  templateUrl: './ribbon-strip-button-small.html',
  styleUrl: './ribbon-strip-button-small.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.ribbon-button-small--icon-only]': 'iconOnly()',
  },
})
export class RibbonStripButtonSmall {
  /**
   * Gets the icon to display.
   */
  public readonly icon: InputSignal<Icon> = input.required<Icon>();

  /**
   * Gets the clockwise rotation of the icon, in degrees. Defaults to none.
   */
  public readonly iconRotation: InputSignal<number> = input<number>(0);

  /**
   * Gets the label displayed beside the icon.
   */
  public readonly label: InputSignal<string> = input.required<string>();

  /**
   * Gets a value indicating whether the button is disabled.
   */
  public readonly disabled: InputSignal<boolean> = input<boolean>(false);

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
