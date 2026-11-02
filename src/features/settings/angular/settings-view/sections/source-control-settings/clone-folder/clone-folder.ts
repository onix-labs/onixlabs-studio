import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  Signal,
  signal,
  WritableSignal,
} from '@angular/core';
import { Button } from '@shared/angular/components/forms/button/button';
import { SettingRow } from '@shared/angular/components/forms/setting-row/setting-row';
import { Icon } from '@shared/angular/icons/icon';
import { Clone } from '@shared/angular/services/clone/clone';

/**
 * Represents the Default Clone Folder row on Version Control › General: the folder clones go into.
 * The folder is not a setting — the main process remembers it, and only its own folder dialog can
 * change it, so a renderer can never point a clone at a folder the user did not choose — so the row
 * shows it and opens that dialog.
 */
@Component({
  selector: 'app-clone-folder',
  imports: [Button, SettingRow],
  templateUrl: './clone-folder.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CloneFolder implements OnInit {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the cloning client, which reads and changes the folder.
   */
  protected readonly cloner: Clone = inject(Clone);

  /**
   * Holds the folder clones go into, or null when none is chosen yet.
   */
  protected readonly folder: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Gets the row's description: the folder, or what happens before one is chosen.
   */
  protected readonly description: Signal<string> = computed((): string => {
    const folder: string | null = this.folder();
    return folder === null
      ? 'The folder clones go into. None is chosen yet; the first clone asks for one.'
      : `The folder clones go into: ${folder}`;
  });

  /**
   * Reads the folder.
   */
  public ngOnInit(): void {
    void this.cloner.parent().then((folder: string | null): void => this.folder.set(folder));
  }

  /**
   * Asks for a new folder. Cancelling the dialog keeps the one there was.
   * @returns Resolves once the dialog has closed.
   */
  protected async choose(): Promise<void> {
    const chosen: string | null = await this.cloner.pickParent();
    if (chosen !== null) {
      this.folder.set(chosen);
    }
  }
}
