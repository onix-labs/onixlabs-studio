import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { WindowLock } from '@shared/angular/services/window-lock/window-lock';
import { Icon } from '@shared/angular/icons/icon';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { TitleStripButtonList } from '../title-strip-button-list/title-strip-button-list';
import { TitleStripTabList } from '../title-strip-tab-list/title-strip-tab-list';
import { TitleStripTabMenu } from '../title-strip-tab-menu/title-strip-tab-menu';
import { WindowControls } from '../window-controls/window-controls';

/**
 * Represents the title strip, hosting the window lock, the action buttons, the tab list, and the
 * window controls.
 */
@Component({
  selector: 'app-title-strip-container',
  imports: [TitleStripButtonList, TitleStripTabList, TitleStripTabMenu, WindowControls, AppIcon],
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
   * Sets whether the window is locked in its current position.
   * @param event The DOM change event raised by the underlying checkbox.
   */
  protected onLockChange(event: Event): void {
    this.windowLock.setLocked((event.target as HTMLInputElement).checked);
  }
}
