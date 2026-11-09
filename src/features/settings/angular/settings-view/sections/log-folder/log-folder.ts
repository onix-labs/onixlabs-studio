import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Button } from '@shared/angular/components/forms/button/button';
import { SettingRow } from '@shared/angular/components/forms/setting-row/setting-row';
import { Icon } from '@shared/angular/icons/icon';
import { Log } from '@shared/angular/services/log/log';

/**
 * Represents the Log Folder row on System Monitor › General: a button that opens the folder the logs
 * are kept in. The folder is main's own; the renderer only asks for it to be opened.
 */
@Component({
  selector: 'app-log-folder',
  imports: [Button, SettingRow],
  template: `
    <app-setting-row
      label="Log Folder"
      description="Where studio.log and each session's log are kept, in Studio's user data."
    >
      <app-button
        variant="ghost"
        label="Open Log Folder"
        [icon]="Icon.FOLDER_OPEN"
        data-testid="log-folder-open"
        (click)="open()"
      />
    </app-setting-row>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LogFolder {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the log service, which opens the folder.
   */
  private readonly log: Log = inject(Log);

  /**
   * Opens the folder.
   */
  protected open(): void {
    void this.log.openFolder();
  }
}
