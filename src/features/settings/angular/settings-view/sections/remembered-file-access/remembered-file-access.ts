import {
  ChangeDetectionStrategy,
  Component,
  inject,
  OnInit,
  signal,
  WritableSignal,
} from '@angular/core';
import { Button } from '@shared/angular/components/forms/button/button';
import { SettingRow } from '@shared/angular/components/forms/setting-row/setting-row';
import { Icon } from '@shared/angular/icons/icon';
import { Security } from '@shared/angular/services/security/security';

/**
 * Represents the Remembered File Access row on Application › Privacy & Content: the files and folders
 * Studio remembers you opened through a system dialog, which it may reopen (from the recent items)
 * without asking again. Each can be forgotten, or all of them at once; a forgotten one asks again
 * before it is reopened. The list is owned by the main process, which enforces it.
 */
@Component({
  selector: 'app-remembered-file-access',
  imports: [Button, SettingRow],
  templateUrl: './remembered-file-access.html',
  styleUrls: ['../section.scss', './remembered-file-access.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RememberedFileAccess implements OnInit {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the security client the list is read and changed through.
   */
  private readonly security: Security = inject(Security);

  /**
   * Holds the remembered paths, newest first.
   */
  protected readonly paths: WritableSignal<readonly string[]> = signal<readonly string[]>([]);

  /**
   * Loads the list when the row is shown.
   */
  public ngOnInit(): void {
    void this.security
      .rememberedAccess()
      .then((paths: readonly string[]): void => this.paths.set(paths));
  }

  /**
   * Forgets one path.
   * @param path The path to forget.
   */
  protected async forget(path: string): Promise<void> {
    this.paths.set(await this.security.forgetRememberedAccess(path));
  }

  /**
   * Forgets every path.
   */
  protected async clear(): Promise<void> {
    this.paths.set(await this.security.clearRememberedAccess());
  }
}
