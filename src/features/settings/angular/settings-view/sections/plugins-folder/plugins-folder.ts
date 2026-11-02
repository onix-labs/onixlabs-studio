import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { Button } from '@shared/angular/components/forms/button/button';
import { SettingRow } from '@shared/angular/components/forms/setting-row/setting-row';
import { Icon } from '@shared/angular/icons/icon';
import { Sideloading } from '@shared/angular/services/plugins/sideloading';

/**
 * Represents the Plugins Folder row on Plugins › General: where plugins placed by hand go, named, with
 * a button that opens it. The folder is main's own; the renderer only asks for it to be opened.
 */
@Component({
  selector: 'app-plugins-folder',
  imports: [Button, SettingRow],
  templateUrl: './plugins-folder.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PluginsFolder {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the sideloading client, which knows the folder and opens it.
   */
  protected readonly sideloading: Sideloading = inject(Sideloading);

  /**
   * Gets the row's description, naming the folder.
   */
  protected readonly description: Signal<string> = computed((): string => {
    const directory: string | null = this.sideloading.directory();
    return directory === null
      ? 'Where plugins placed by hand go, one folder each holding its plugin.json.'
      : `Where plugins placed by hand go, one folder each holding its plugin.json: ${directory}`;
  });

  /**
   * Opens the folder.
   */
  protected open(): void {
    void this.sideloading.openFolder();
  }
}
