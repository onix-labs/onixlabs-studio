import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Button } from '@shared/angular/components/forms/button/button';
import { Icon } from '@shared/angular/icons/icon';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Log } from '@shared/angular/services/log/log';
import { Plugins } from '@shared/angular/services/plugins/plugins';

/**
 * Represents the last plugin action's failure: what went wrong, in words the user can act on, and the
 * two things to do about it — try the install again, or open the folder the log is kept in.
 *
 * Shared by the Plugin Manager and the setup wizard, because a fresh installation meets this first in
 * the wizard, and a failure there that said only "the application log records what failed" was a dead
 * end for someone who had never opened Studio before.
 */
@Component({
  selector: 'app-plugin-install-error',
  imports: [AppIcon, Button],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './plugin-install-error.scss',
  template: `
    @if (plugins.error(); as message) {
      <div class="install-error" role="alert">
        <app-icon class="install-error__icon" [icon]="Icon.WARNING" />
        <span class="install-error__message">{{ message }}</span>
        <span class="install-error__actions">
          @if (plugins.failedInstall(); as id) {
            <app-button
              variant="ghost"
              label="Try Again"
              data-testid="plugin-install-retry"
              [disabled]="plugins.busy()"
              (click)="retry(id)"
            />
          }
          <app-button
            variant="ghost"
            label="Open Log Folder"
            data-testid="plugin-install-log"
            (click)="openLog()"
          />
        </span>
      </div>
    }
  `,
})
export class PluginInstallError {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the plugin client, exposed for the template.
   */
  protected readonly plugins: Plugins = inject(Plugins);

  /**
   * Holds the log service, which opens the log folder.
   */
  private readonly log: Log = inject(Log);

  /**
   * Tries the failed install again. The user consented to it a moment ago, so it is not asked again.
   * @param id The plugin to install.
   */
  protected retry(id: string): void {
    void this.plugins.install(id);
  }

  /**
   * Opens the folder the log is kept in.
   */
  protected openLog(): void {
    void this.log.openFolder();
  }
}
