import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  Signal,
  WritableSignal,
} from '@angular/core';
import { normalisePollingFolder, sanitizePollingFolders } from '@shared/api/polling-folders';
import { Button } from '@shared/angular/components/forms/button/button';
import { SettingRow } from '@shared/angular/components/forms/setting-row/setting-row';
import { TextField } from '@shared/angular/components/forms/text-field/text-field';
import { Icon } from '@shared/angular/icons/icon';
import { FileSystem } from '@shared/angular/services/file-system/file-system';
import { Log } from '@shared/angular/services/log/log';
import { Settings } from '@shared/angular/services/settings/settings';
import { SETTINGS_BY_KEY } from '@shared/angular/services/settings/settings-registry';
import type { SettingDef } from '@shared/angular/services/settings/settings-schema';

/**
 * Represents the Polled Folders row on Workspaces › File Watching (#1254): the folders, such as
 * network shares and container mounts, whose files Studio checks on a timer because the system does
 * not report the changes made in them elsewhere. A folder is chosen in the folder dialog or typed, for
 * a mount the dialog cannot reach, and removed per row.
 */
@Component({
  selector: 'app-polling-folders',
  imports: [Button, SettingRow, TextField],
  templateUrl: './polling-folders.html',
  styleUrls: ['../section.scss', './polling-folders.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PollingFolders {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the settings the folders are kept in.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Holds the file system, whose dialog chooses a folder.
   */
  private readonly fileSystem: FileSystem = inject(FileSystem);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Gets the setting's registry entry, whose title and description the row shows.
   */
  private readonly definition: SettingDef | undefined = SETTINGS_BY_KEY.get(
    'workspaces.pollingFolders',
  );

  /**
   * Gets the row's title.
   */
  protected readonly title: string = this.definition?.title ?? '';

  /**
   * Gets the row's description.
   */
  protected readonly description: string = this.definition?.description ?? '';

  /**
   * Gets the label of the button that opens the folder dialog.
   */
  protected readonly chooseLabel: string = $localize`:Button that opens the folder dialog to add a polled folder:Add Folder…`;

  /**
   * Gets the label of the button that adds the typed folder.
   */
  protected readonly addLabel: string = $localize`:Button that adds the typed folder to the polled folders:Add`;

  /**
   * Gets the accessible name of the field a folder is typed in.
   */
  protected readonly fieldLabel: string = $localize`:Accessible name of the field a polled folder's path is typed in:Folder to poll`;

  /**
   * Gets the polled folders, as the setting holds them.
   */
  protected readonly folders: Signal<readonly string[]> = computed((): readonly string[] =>
    sanitizePollingFolders(this.settings.value('workspaces.pollingFolders')()),
  );

  /**
   * Holds the folder being typed.
   */
  protected readonly draft: WritableSignal<string> = signal<string>('');

  /**
   * Gets whether the typed folder can be added: it is an absolute path not already listed.
   */
  protected readonly canAdd: Signal<boolean> = computed((): boolean => {
    const folder: string = normalisePollingFolder(this.draft());
    return folder !== '' && !this.folders().includes(folder);
  });

  /**
   * Gets the accessible name of a row's remove button.
   * @param folder The folder the row lists.
   * @returns Returns the name.
   */
  protected removeLabel(folder: string): string {
    return $localize`:Accessible name of the button that stops polling a folder:Stop polling ${folder}:folder:`;
  }

  /**
   * Opens the folder dialog and adds the chosen folder.
   * @returns Returns a promise that resolves once the dialog has closed.
   */
  protected async choose(): Promise<void> {
    const folder: string | null = await this.fileSystem.pickPath('folder');
    if (folder !== null) {
      this.addFolder(folder);
    }
  }

  /**
   * Adds the typed folder and clears the field.
   */
  protected add(): void {
    if (!this.canAdd()) {
      return;
    }
    this.addFolder(this.draft());
    this.draft.set('');
  }

  /**
   * Stops polling a folder.
   * @param folder The folder to remove.
   */
  protected remove(folder: string): void {
    this.log.info('settings.workspaces', 'Polled folder removed', folder);
    this.settings.set(
      'workspaces.pollingFolders',
      this.folders().filter((existing: string): boolean => existing !== folder),
    );
  }

  /**
   * Adds a folder to the list, unless it is already there or is not an absolute path.
   * @param value The folder as chosen or typed.
   */
  private addFolder(value: string): void {
    const folder: string = normalisePollingFolder(value);
    if (folder === '' || this.folders().includes(folder)) {
      return;
    }
    this.log.info('settings.workspaces', 'Polled folder added', folder);
    this.settings.set('workspaces.pollingFolders', [...this.folders(), folder]);
  }
}
