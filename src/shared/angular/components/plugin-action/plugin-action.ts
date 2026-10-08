import { ChangeDetectionStrategy, Component, inject, input, InputSignal } from '@angular/core';
import type { PluginSummary } from '@shared/api/plugin-channels';
import { Button } from '@shared/angular/components/forms/button/button';
import { ProgressBar } from '@shared/angular/components/progress-bar/progress-bar';
import { Icon } from '@shared/angular/icons/icon';
import { Plugins } from '@shared/angular/services/plugins/plugins';
import { canInstall, canUninstall, canUpdate } from './plugin-action-rules';

/**
 * The one action a plugin's row offers, wherever plugins are listed — the Plugin Manager and the setup
 * wizard draw the same control, so a plugin reads and behaves the same in both: Install (success),
 * Update (info), Remove (danger), and while it is being worked on an indeterminate bar in its place.
 *
 * Installing and updating go through the shared consent; removing goes straight to the plugin client.
 * The call site sizes it: it fills the width it is given.
 */
@Component({
  selector: 'app-plugin-action',
  imports: [Button, ProgressBar],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './plugin-action.scss',
  template: `
    <!-- While this plugin is being installed, updated or removed its button gives way to an
         indeterminate bar: the work has no known length, and a merely-disabled button reads as nothing
         happening. Other rows keep their buttons, disabled while anything is busy. -->
    @if (plugin().state === 'busy') {
      <app-progress-bar [ariaLabel]="'Working on ' + plugin().name" />
    } @else if (canUpdate(plugin())) {
      <app-button
        variant="solid"
        tone="info"
        label="Update"
        [icon]="Icon.DOWNLOAD_DUOTONE"
        [disabled]="plugins.busy()"
        (click)="install()"
      />
    } @else if (canUninstall(plugin())) {
      <app-button
        variant="solid"
        tone="danger"
        label="Remove"
        [icon]="Icon.TRASH_DUOTONE"
        [disabled]="plugins.busy()"
        (click)="uninstall()"
      />
    } @else {
      <!-- An unsupported plugin still shows its Install, disabled: removing the button would leave the
           row with no statement of what it would do, and the row already says why it cannot. -->
      <app-button
        variant="solid"
        [tone]="canInstall(plugin()) ? 'success' : 'neutral'"
        label="Install"
        [icon]="Icon.DOWNLOAD_DUOTONE"
        [disabled]="plugins.busy() || !canInstall(plugin())"
        (click)="install()"
      />
    }
  `,
})
export class PluginAction {
  /**
   * Gets the plugin the action is for.
   */
  public readonly plugin: InputSignal<PluginSummary> = input.required<PluginSummary>();

  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the plugin client, exposed for the template.
   */
  protected readonly plugins: Plugins = inject(Plugins);

  /**
   * Gets whether the plugin can be installed, exposed for the template.
   */
  protected readonly canInstall: typeof canInstall = canInstall;

  /**
   * Gets whether the plugin can be removed, exposed for the template.
   */
  protected readonly canUninstall: typeof canUninstall = canUninstall;

  /**
   * Gets whether the plugin has an update, exposed for the template.
   */
  protected readonly canUpdate: typeof canUpdate = canUpdate;

  /**
   * Installs or updates the plugin, after the terms have been accepted. Verification proves a payload
   * has not been tampered with, never that the code is good, so the residual risk is the user's to
   * accept — and an update is new code from the same publisher, asked the same way.
   */
  protected install(): void {
    void this.plugins.installWithConsent(this.plugin().id);
  }

  /**
   * Removes the plugin.
   */
  protected uninstall(): void {
    void this.plugins.uninstall(this.plugin().id);
  }
}
