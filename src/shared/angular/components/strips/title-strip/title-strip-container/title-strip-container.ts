import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  Signal,
} from '@angular/core';
import { Settings } from '@shared/angular/services/settings/settings';
import { Studio } from '@shared/angular/services/studio/studio';
import { Theme } from '@shared/angular/services/theme/theme';
import { WindowLock } from '@shared/angular/services/window-lock/window-lock';
import { Icon } from '@shared/angular/icons/icon';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { TitleStripButtonList } from '../title-strip-button-list/title-strip-button-list';
import { TitleStripTabList } from '../title-strip-tab-list/title-strip-tab-list';

/**
 * Represents the title strip, hosting the window lock, the action buttons, and the tab list. The
 * window controls are the platform's own: inset over the strip's leading end on macOS, drawn over its
 * trailing end on Windows, and in the native title bar above it on Linux.
 */
@Component({
  selector: 'app-title-strip-container',
  imports: [TitleStripButtonList, TitleStripTabList, AppIcon],
  templateUrl: './title-strip-container.html',
  styleUrl: './title-strip-container.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.title-strip-container--locked]': 'windowLock.locked()',
  },
})
export class TitleStripContainer {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the window-lock state controlling whether the window may be dragged.
   */
  protected readonly windowLock: WindowLock = inject(WindowLock);

  /**
   * Holds the settings store the switch's visibility comes from.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Gets a value indicating whether the strip carries the window-lock switch.
   */
  protected readonly showWindowLock: Signal<boolean> = this.settings.applicationShowWindowLock;

  /**
   * Initializes a new instance of the {@link TitleStripContainer} class, keeping the caption buttons
   * Windows draws over the strip in the strip's own button colour as the theme changes. The colour is
   * read back from the rendered strip rather than restated, so the theme stylesheets stay its only
   * source; and it is read after render, once the theme's root attribute has been applied.
   */
  public constructor() {
    const host: HTMLElement = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    const studio: Studio = inject(Studio);
    const theme: Theme = inject(Theme);
    afterRenderEffect((): void => {
      theme.resolvedMode();
      const color: string = getComputedStyle(host)
        .getPropertyValue('--title-strip-button-foreground-color')
        .trim();
      studio.setCaptionSymbolColor(color);
    });
  }

  /**
   * Sets whether the window is locked in its current position.
   * @param event The DOM change event raised by the underlying checkbox.
   */
  protected onLockChange(event: Event): void {
    this.windowLock.setLocked((event.target as HTMLInputElement).checked);
  }
}
