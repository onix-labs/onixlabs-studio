import { CdkMenuTrigger } from '@angular/cdk/menu';
import {
  ChangeDetectionStrategy,
  Component,
  input,
  InputSignal,
  output,
  OutputEmitterRef,
} from '@angular/core';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Menu } from '@shared/angular/components/menu/menu';
import { RibbonMenuItem } from '@shared/angular/components/ribbon-strip/ribbon-strip-menu-button/ribbon-strip-menu-button';
import { Icon } from '@shared/angular/icons/icon';

/**
 * Represents an actions button in the ribbon: a large button that carries no primary action of its
 * own — its whole face opens a dropdown of activatable rows (an {@link Menu}). Use it where the button
 * stands for a *set* of things to act on rather than one command; the chosen row's id is emitted
 * through {@link selected}. Unlike {@link RibbonStripMenuButton}, there is no split primary action and
 * no `action` output — every press opens the menu.
 */
@Component({
  selector: 'app-ribbon-strip-actions-button',
  imports: [AppIcon, CdkMenuTrigger, Menu],
  templateUrl: './ribbon-strip-actions-button.html',
  styleUrl: './ribbon-strip-actions-button.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RibbonStripActionsButton {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the icon shown above the label.
   */
  public readonly icon: InputSignal<Icon> = input.required<Icon>();

  /**
   * Gets the label shown beneath the icon.
   */
  public readonly label: InputSignal<string> = input.required<string>();

  /**
   * Gets the rows listed in the dropdown the button opens.
   */
  public readonly items: InputSignal<readonly RibbonMenuItem[]> =
    input.required<readonly RibbonMenuItem[]>();

  /**
   * Gets a value indicating whether the button is disabled (its dropdown cannot be opened).
   */
  public readonly disabled: InputSignal<boolean> = input<boolean>(false);

  /**
   * Emits the {@link RibbonMenuItem.id} of the chosen dropdown row.
   */
  public readonly selected: OutputEmitterRef<string> = output<string>();

  /**
   * Handles a dropdown row being chosen, emitting the {@link selected} event.
   * @param id The identifier of the chosen row.
   */
  protected onSelect(id: string): void {
    this.selected.emit(id);
  }
}
