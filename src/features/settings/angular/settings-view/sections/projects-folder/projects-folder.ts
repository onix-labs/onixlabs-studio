import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
  Signal,
  WritableSignal,
} from '@angular/core';
import { Button } from '@shared/angular/components/forms/button/button';
import { SettingRow } from '@shared/angular/components/forms/setting-row/setting-row';
import { Icon } from '@shared/angular/icons/icon';
import { NewProject } from '@shared/angular/services/new-project/new-project';

/**
 * Represents the Default Projects Folder row on Workspaces › New Projects: the folder new projects
 * start in, named, with a button that changes it. The main process's own dialog chooses it, as with a
 * clone's folder: the renderer never names where a project goes.
 */
@Component({
  selector: 'app-projects-folder',
  imports: [Button, SettingRow],
  templateUrl: './projects-folder.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectsFolder implements OnInit {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the new-project client, which knows the folder and changes it.
   */
  private readonly newProject: NewProject = inject(NewProject);

  /**
   * Holds the folder, or null before one is chosen.
   */
  private readonly folder: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Gets the row's description, naming the folder.
   */
  protected readonly description: Signal<string> = computed((): string => {
    const folder: string | null = this.folder();
    return folder === null
      ? 'Where new projects are made. Separate from the folder clones go into.'
      : `Where new projects are made. Separate from the folder clones go into: ${folder}`;
  });

  /**
   * Reads the folder.
   */
  public ngOnInit(): void {
    void this.newProject.defaultFolder().then((folder: string | null): void => {
      this.folder.set(folder);
    });
  }

  /**
   * Asks for a new folder, in the main process's dialog.
   */
  protected async choose(): Promise<void> {
    const chosen: string | null = await this.newProject.pickDefaultFolder();
    if (chosen !== null) {
      this.folder.set(chosen);
    }
  }
}
