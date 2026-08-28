import { CdkMenu, CdkMenuItem, CdkMenuTrigger } from '@angular/cdk/menu';
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
import { ButtonTone } from '@shared/angular/components/forms/button/button';
import { MenuPointerGuard } from './menu-pointer-guard';
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
   * Gets the state of a row that is a binary switch, shown with a checkbox before its label. Leave it
   * undefined for an ordinary command, which is what distinguishes the two: an unchecked switch is
   * still a switch and must keep its (empty) box.
   *
   * This is the counterpart to {@link active}, not a synonym for it. `active` accents the chosen row
   * of a pick-one list; a switch is independent of its neighbours, and several may be on at once.
   */
  readonly checked?: boolean;

  /**
   * Gets the rows of the submenu this item opens, or undefined for a row that is acted on directly.
   *
   * A row with children is a container: it opens its own panel on hover or on the right-arrow key,
   * and choosing it does nothing, so it never emits through {@link Menu.selected}. Its own children
   * may nest further — the panel renders itself recursively.
   */
  readonly children?: readonly MenuItem[];

  /**
   * Gets a value indicating whether the row is a divider rather than an entry: a rule drawn between
   * groups, carrying no label and never selectable. A long menu without them reads as one undivided
   * list, which is exactly the problem grouping solves.
   */
  readonly separator?: boolean;

  /**
   * Gets a value indicating whether the item is inert (shown muted and not selectable).
   */
  readonly disabled?: boolean;

  /**
   * Gets the meaning the row carries, which colours its **glyph** so its state reads at a glance (a
   * green `success`, a red `danger`) — for example a start/stop list where each row's icon tracks
   * whether it is running. The label stays in the menu's normal foreground; omitted (or `accent`)
   * leaves the glyph there too.
   */
  readonly tone?: ButtonTone;

  /**
   * Gets a trailing status shown after the label in a muted foreground — a secondary note that reads
   * as state without competing with the label (for example `(running)` on a start/stop row).
   */
  readonly status?: string;
}

/**
 * A chosen menu row together with the data its menu was opened with.
 */
export interface MenuChoice {
  /**
   * Gets the chosen row's identifier.
   */
  readonly id: string;

  /**
   * Gets the data the menu's trigger opened with, or undefined when it opened without any.
   */
  readonly data: unknown;
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
  imports: [AppIcon, CdkMenu, CdkMenuItem, CdkMenuTrigger, MenuPointerGuard],
  templateUrl: './menu.html',
  styleUrl: './menu.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Menu {
  /**
   * Gets the icon set, exposed for the template's submenu caret.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the rows shown in the menu. Menus whose rows depend on what the trigger was pointing at
   * supply {@link itemsFor} instead.
   */
  public readonly items: InputSignal<readonly MenuItem[]> = input<readonly MenuItem[]>([]);

  /**
   * Gets the factory that builds the rows from the data its trigger opened with, or null for a menu
   * whose rows are fixed.
   *
   * A context menu's rows depend on what was right-clicked, and that subject arrives as the trigger's
   * data rather than as an input — so it cannot be known before the menu opens. Deriving the rows
   * from it here keeps the subject and its rows in one atomic step; the alternative, writing the
   * subject to a signal from a `contextmenu` handler and hoping it lands before the overlay renders,
   * is a race against listener ordering.
   */
  public readonly itemsFor: InputSignal<((data: unknown) => readonly MenuItem[]) | null> = input<
    ((data: unknown) => readonly MenuItem[]) | null
  >(null);

  /**
   * Gets where the menu opens relative to its trigger.
   */
  public readonly placement: InputSignal<MenuPlacement> = input<MenuPlacement>('down-start');

  /**
   * Emits the chosen row's id when an item is selected.
   */
  public readonly selected: OutputEmitterRef<string> = output<string>();

  /**
   * Emits the chosen row's id together with the data the menu was opened with, for menus whose rows
   * act on a subject.
   */
  public readonly chosen: OutputEmitterRef<MenuChoice> = output<MenuChoice>();

  /**
   * Gets the panel template the caller's trigger opens through `cdkMenuTriggerFor`.
   *
   * It is the same template each submenu opens, so the caller's trigger and every nested row build
   * their panel the same way — see the template for why that matters.
   */
  public readonly panel: Signal<TemplateRef<unknown> | undefined> =
    viewChild<TemplateRef<unknown>>('surface');

  /**
   * Gets the overlay position the caller's trigger passes to `cdkMenuPosition`.
   */
  public readonly position: Signal<readonly ConnectedPosition[]> = computed(
    (): readonly ConnectedPosition[] => MENU_POSITIONS[this.placement()],
  );

  /**
   * Resolves the rows to render for the data the menu was opened with.
   * @param data The trigger's data, or undefined for a menu opened without any.
   * @returns Returns the rows to render.
   */
  protected rowsFor(data: unknown): readonly MenuItem[] {
    return this.itemsFor()?.(data) ?? this.items();
  }

  /**
   * Resolves a row's submenu rows, treating an empty list as no submenu at all: a row that opens an
   * empty panel reads as a bug rather than as an answer, exactly as an empty context menu does.
   * @param item The row to resolve.
   * @returns Returns the submenu's rows, or null when the row is acted on directly.
   */
  protected childrenOf(item: MenuItem): readonly MenuItem[] | null {
    return item.children?.length ? item.children : null;
  }

  /**
   * Emits the given row's id as the selection, and the id with its subject for callers that need it.
   * @param id The chosen row's id.
   * @param data The data the menu was opened with.
   */
  protected onSelect(id: string, data: unknown): void {
    this.selected.emit(id);
    this.chosen.emit({ id, data });
  }
}
