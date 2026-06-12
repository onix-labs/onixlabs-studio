import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Studio } from '../../../../services/studio/studio';
import { Icon } from '../../../../icons/icon';
import { AppIcon } from '../../../shared/icon/app-icon';

/**
 * Represents the custom window controls (minimize, maximize, close) shown on platforms without
 * native inset window controls.
 */
@Component({
  selector: 'app-window-controls',
  imports: [AppIcon],
  templateUrl: './window-controls.html',
  styleUrl: './window-controls.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WindowControls {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the Studio bridge wrapper used to control the window.
   */
  private readonly studio: Studio = inject(Studio);

  /**
   * Gets a value indicating whether the window controls should be shown.
   */
  protected readonly visible: boolean = this.studio.showWindowControls;

  /**
   * Minimizes the application window.
   */
  protected minimize(): void {
    this.studio.minimizeWindow();
  }

  /**
   * Toggles the application window between its maximized and restored states.
   */
  protected toggleMaximize(): void {
    this.studio.toggleMaximizeWindow();
  }

  /**
   * Closes the application window.
   */
  protected close(): void {
    this.studio.closeWindow();
  }
}
