import { CdkMenu, CdkMenuItem } from '@angular/cdk/menu';
import { ConnectedPosition } from '@angular/cdk/overlay';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  InputSignal,
  output,
  OutputEmitterRef,
  Signal,
  TemplateRef,
  viewChild,
} from '@angular/core';
import { Icon } from '@shared/angular/icons/icon';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { MENU_POSITIONS, MenuPlacement } from './menu-position';

/**
 * Describes one selectable row in a {@link Menu}.
 */
export interface MenuItem {
  /**
   * Gets the identifier emitted when the item is chosen.
   */
  readonly id: string;

  /**
   * Gets the item's label.
   */
  readonly label: string;

  /**
   * Gets the item's leading icon, if any.
   */
  readonly icon?: Icon;

  /**
   * Gets a value indicating whether the item is the current selection, shown with an accent marker.
   */
  readonly active?: boolean;

  /**
   * Gets a value indicating whether the item is inert (shown muted and not selectable).
   */
  readonly disabled?: boolean;
}

/**
 * Represents a reusable drop menu: a list of activatable rows shown in a CDK overlay, opened by a
 * trigger the caller owns. The caller binds its trigger to {@link panel} and {@link position} and
 * receives the chosen row's id through {@link select}. The rows are rendered here — rather than
 * projected — so their `cdkMenuItem`s share this component's `cdkMenu` for keyboard navigation and
 * close-on-select. Structurally different popovers (secondary buttons, animated rows) keep their own
 * bespoke markup and only share {@link MENU_POSITIONS}.
 */
@Component({
  selector: 'app-menu',
  imports: [AppIcon, CdkMenu, CdkMenuItem],
  templateUrl: './menu.html',
  styleUrl: './menu.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Menu {
  /**
   * Gets the rows shown in the menu.
   */
  public readonly items: InputSignal<readonly MenuItem[]> = input.required<readonly MenuItem[]>();

  /**
   * Gets where the menu opens relative to its trigger.
   */
  public readonly placement: InputSignal<MenuPlacement> = input<MenuPlacement>('down-start');

  /**
   * Emits the chosen row's id when an item is selected.
   */
  public readonly selected: OutputEmitterRef<string> = output<string>();

  /**
   * Gets the panel template the caller's trigger opens through `cdkMenuTriggerFor`.
   */
  public readonly panel: Signal<TemplateRef<unknown> | undefined> =
    viewChild<TemplateRef<unknown>>('panel');

  /**
   * Gets the overlay position the caller's trigger passes to `cdkMenuPosition`.
   */
  public readonly position: Signal<readonly ConnectedPosition[]> = computed(
    (): readonly ConnectedPosition[] => MENU_POSITIONS[this.placement()],
  );

  /**
   * Emits the given row's id as the selection.
   * @param id The chosen row's id.
   */
  protected onSelect(id: string): void {
    this.selected.emit(id);
  }
}
