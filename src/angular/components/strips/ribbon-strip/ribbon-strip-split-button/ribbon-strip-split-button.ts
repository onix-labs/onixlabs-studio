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
 * Represents a split button in the ribbon: a large primary action with an attached chevron that
 * opens a related menu.
 */
@Component({
  selector: 'app-ribbon-strip-split-button',
  imports: [AppIcon],
  templateUrl: './ribbon-strip-split-button.html',
  styleUrl: './ribbon-strip-split-button.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RibbonStripSplitButton {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the icon for the primary action.
   */
  public readonly icon: InputSignal<Icon> = input.required<Icon>();

  /**
   * Gets the label displayed beneath the primary action's icon.
   */
  public readonly label: InputSignal<string> = input.required<string>();

  /**
   * Gets the label displayed in the attached menu strip beside the chevron.
   */
  public readonly menuLabel: InputSignal<string> = input.required<string>();

  /**
   * Gets a value indicating whether the split button is disabled.
   */
  public readonly disabled: InputSignal<boolean> = input<boolean>(false);

  /**
   * Emits when the primary action is activated.
   */
  public readonly action: OutputEmitterRef<void> = output<void>();

  /**
   * Emits when the attached menu is requested via the chevron.
   */
  public readonly menu: OutputEmitterRef<void> = output<void>();

  /**
   * Handles a click on the primary action, emitting the {@link action} event.
   */
  protected onAction(): void {
    this.action.emit();
  }

  /**
   * Handles a click on the chevron, emitting the {@link menu} event.
   */
  protected onMenu(): void {
    this.menu.emit();
  }
}
