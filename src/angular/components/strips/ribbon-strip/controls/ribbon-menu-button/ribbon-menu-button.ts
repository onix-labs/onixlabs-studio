import { CdkMenu, CdkMenuItem, CdkMenuTrigger } from '@angular/cdk/menu';
import { ConnectedPosition } from '@angular/cdk/overlay';
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
 * Describes a single entry in a {@link RibbonMenuButton}'s dropdown.
 */
export interface RibbonMenuItem {
  /**
   * Gets the identifier emitted through {@link RibbonMenuButton.select} when the item is chosen.
   */
  readonly id: string;

  /**
   * Gets the label shown for the item.
   */
  readonly label: string;

  /**
   * Gets the optional icon shown beside the item's label.
   */
  readonly icon?: Icon;
}

/**
 * Represents a menu button in the ribbon: a large primary action with an attached chevron that opens
 * a dropdown of related variants. Unlike {@link RibbonSplitButton}, whose chevron emits a single menu
 * event, this control renders the variants itself and emits the chosen one through {@link select}.
 */
@Component({
  selector: 'app-ribbon-menu-button',
  imports: [AppIcon, CdkMenuTrigger, CdkMenu, CdkMenuItem],
  templateUrl: './ribbon-menu-button.html',
  styleUrl: './ribbon-menu-button.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RibbonMenuButton {
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
   * Gets the items listed in the dropdown the chevron opens.
   */
  public readonly items: InputSignal<readonly RibbonMenuItem[]> =
    input.required<readonly RibbonMenuItem[]>();

  /**
   * Gets a value indicating whether the menu button is disabled.
   */
  public readonly disabled: InputSignal<boolean> = input<boolean>(false);

  /**
   * Emits when the primary action is activated.
   */
  public readonly action: OutputEmitterRef<void> = output<void>();

  /**
   * Emits the {@link RibbonMenuItem.id} of the chosen dropdown item.
   */
  public readonly selected: OutputEmitterRef<string> = output<string>();

  /**
   * Gets the position that opens the dropdown downward from the chevron, their left edges aligned.
   */
  protected readonly menuPosition: readonly ConnectedPosition[] = [
    { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top' },
  ];

  /**
   * Handles a click on the primary action, emitting the {@link action} event.
   */
  protected onAction(): void {
    this.action.emit();
  }

  /**
   * Handles a dropdown item being chosen, emitting the {@link selected} event.
   * @param id The identifier of the chosen item.
   */
  protected onSelect(id: string): void {
    this.selected.emit(id);
  }
}
