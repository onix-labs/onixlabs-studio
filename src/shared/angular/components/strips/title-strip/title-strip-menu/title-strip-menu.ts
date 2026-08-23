import { CdkMenuTrigger } from '@angular/cdk/menu';
import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Menu, MenuItem } from '@shared/angular/components/menu/menu';
import { AppMenu } from '@shared/angular/services/app-menu/app-menu';
import { MenuContribution, MenuEntry } from '@shared/angular/services/app-menu/app-menu-model';
import { Icon } from '@shared/angular/icons/icon';

/**
 * The application menu, in the window.
 *
 * A single button on the title strip opening the whole menu as a drop-down: each top-level section is a
 * row whose submenu holds its commands, nesting as deep as the model does. It is the same contextual
 * menu the native macOS bar renders — the same {@link AppMenu} model, the same command ids, the same
 * live enablement and checkboxes — drawn by the application instead of the platform.
 *
 * This exists because a native menu on Windows and Linux is drawn *inside* the window frame, above the
 * application's own title strip, which looks wrong against custom chrome. Rather than a software menu
 * bar imitating one, the menu collapses to one button beside the other title-strip actions, where it
 * reads as part of the application rather than as a transplanted OS affordance.
 */
@Component({
  selector: 'app-title-strip-menu',
  imports: [AppIcon, Menu, CdkMenuTrigger],
  templateUrl: './title-strip-menu.html',
  styleUrl: './title-strip-menu.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TitleStripMenu {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the composed application menu.
   */
  private readonly appMenu: AppMenu = inject(AppMenu);

  /**
   * Gets the menu as rows: one per top-level section, each carrying its commands as a submenu.
   */
  protected readonly rows: Signal<readonly MenuItem[]> = computed((): readonly MenuItem[] =>
    this.appMenu
      .sections()
      .map(
        (section: MenuContribution): MenuItem => ({
          id: `section:${section.id}`,
          label: section.label,
          children: TitleStripMenu.toRows(section.items),
        }),
      )
      // A section whose every entry belongs to a feature that is no longer active can empty out; an
      // empty submenu would open onto nothing, so the section goes rather than misleading.
      .filter((row: MenuItem): boolean => (row.children?.length ?? 0) > 0),
  );

  /**
   * Runs the chosen command through the same path the native menu's click round-trip uses, so both
   * surfaces behave identically — including native window roles, which are dispatched to the main
   * process.
   * @param id The chosen row's identifier.
   */
  protected onSelect(id: string): void {
    this.appMenu.dispatch(id);
  }

  /**
   * Converts menu entries into menu rows.
   *
   * The accelerator becomes the row's trailing status, which is where a menu conventionally shows it and
   * what that muted slot is for. A checkbox entry carries `checked` so the row renders its tick; a plain
   * command must leave it undefined, or every row would draw an empty checkbox gutter.
   * @param entries The entries to convert.
   * @returns Returns the rows.
   */
  private static toRows(entries: readonly MenuEntry[]): readonly MenuItem[] {
    return entries.map((entry: MenuEntry, index: number): MenuItem => {
      if (entry.kind === 'separator') {
        return { id: `separator:${index}`, label: '', separator: true };
      }
      const children: readonly MenuItem[] | undefined =
        entry.items === undefined ? undefined : TitleStripMenu.toRows(entry.items);
      return {
        id: entry.id ?? `entry:${index}`,
        label: entry.label ?? '',
        ...(entry.kind === 'checkbox' ? { checked: entry.checked === true } : {}),
        ...(entry.enabled === false ? { disabled: true } : {}),
        ...(entry.accelerator === undefined
          ? {}
          : { status: TitleStripMenu.readableAccelerator(entry.accelerator) }),
        ...(children === undefined ? {} : { children }),
      };
    });
  }

  /**
   * Renders an Electron accelerator the way a menu shows it.
   *
   * Electron's notation is written for the platform to parse, not for a person to read: on macOS the
   * conventional glyphs are expected, and everywhere else `CmdOrCtrl` has to resolve to the key that
   * platform actually uses.
   * @param accelerator The accelerator in Electron's notation.
   * @returns Returns the display form.
   */
  private static readableAccelerator(accelerator: string): string {
    const mac: boolean = navigator.userAgent.includes('Mac');
    if (!mac) {
      return accelerator.replace('CmdOrCtrl', 'Ctrl').split('+').join('+');
    }
    return accelerator
      .split('+')
      .map((part: string): string => {
        switch (part) {
          case 'CmdOrCtrl':
          case 'Cmd':
            return '⌘';
          case 'Shift':
            return '⇧';
          case 'Alt':
            return '⌥';
          case 'Ctrl':
            return '⌃';
          default:
            return part;
        }
      })
      .join('');
  }
}
