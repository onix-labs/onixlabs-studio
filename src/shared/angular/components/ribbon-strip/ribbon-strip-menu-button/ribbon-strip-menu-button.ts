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
import { ButtonTone } from '@shared/angular/components/forms/button/button';
import { Icon } from '@shared/angular/icons/icon';

/**
 * Describes a single entry in a {@link RibbonStripMenuButton}'s dropdown.
 */
export interface RibbonMenuItem {
  /**
   * Gets the identifier emitted through {@link RibbonStripMenuButton.select} when the item is chosen.
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

  /**
   * Gets a value indicating whether the item is the current selection, shown with an accent marker.
   * Used by menus that list a set one member of which is showing (for example the layout presets).
   */
  readonly active?: boolean;

  /**
   * Gets a value indicating whether the item is inert (shown muted and not selectable).
   */
  readonly disabled?: boolean;

  /**
   * Gets the meaning the row carries, which colours its glyph so its state reads at a glance (a green
   * `success`, a red `danger`). Omitted (or `accent`) leaves the glyph in the menu's default
   * foreground.
   */
  readonly tone?: ButtonTone;

  /**
   * Gets a trailing status shown after the label in a muted foreground — a secondary state note (for
   * example `(running)`) that does not compete with the label.
   */
  readonly status?: string;
}

/**
 * Represents a menu button in the ribbon: a large primary action with an attached chevron that opens
 * a dropdown of related variants. Unlike {@link RibbonStripSplitButton}, whose chevron emits a single menu
 * event, this control renders the variants itself and emits the chosen one through {@link select}.
 */
@Component({
  selector: 'app-ribbon-strip-menu-button',
  imports: [AppIcon, CdkMenuTrigger, Menu],
  templateUrl: './ribbon-strip-menu-button.html',
  styleUrl: './ribbon-strip-menu-button.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RibbonStripMenuButton {
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
   * Gets the meaning the button carries, which colours it. Defaults to the accent, matching every other
   * ribbon button; a caller states a state tone (a destructive `danger`) for a command whose meaning
   * should read at a glance. As on {@link RibbonStripButton} the tone colours the hover surface only, so
   * the control rests exactly like its neighbours and reads its meaning under the pointer — and both
   * halves take it together, since hovering either lifts the whole control.
   */
  public readonly tone: InputSignal<ButtonTone> = input<ButtonTone>('accent');

  /**
   * Emits when the primary action is activated.
   */
  public readonly action: OutputEmitterRef<void> = output<void>();

  /**
   * Emits the {@link RibbonMenuItem.id} of the chosen dropdown item.
   */
  public readonly selected: OutputEmitterRef<string> = output<string>();

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
