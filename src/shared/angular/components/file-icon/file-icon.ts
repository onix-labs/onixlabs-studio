import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  InputSignal,
  Signal,
} from '@angular/core';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Icon } from '@shared/angular/icons/icon';
import { IconThemes } from '@shared/angular/services/icon-themes/icon-themes';

/**
 * Renders a file's or folder's icon: the active icon theme's picture, or Studio's own icon when there
 * is no theme or it has nothing to say.
 */
@Component({
  selector: 'app-file-icon',
  imports: [AppIcon],
  templateUrl: './file-icon.html',
  styleUrl: './file-icon.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.file-icon--picture]': 'picture() !== undefined' },
})
export class FileIcon {
  /**
   * Holds the active icon theme.
   */
  private readonly themes: IconThemes = inject(IconThemes);

  /**
   * Gets the path, or just the name, of what is drawn. Null draws {@link icon}.
   */
  public readonly path: InputSignal<string | null> = input.required<string | null>();

  /**
   * Gets Studio's own icon for it.
   */
  public readonly icon: InputSignal<Icon> = input.required<Icon>();

  /**
   * Gets what is drawn.
   */
  public readonly kind: InputSignal<'file' | 'folder' | 'root'> = input<'file' | 'folder' | 'root'>(
    'file',
  );

  /**
   * Gets a value indicating whether a folder is expanded.
   */
  public readonly expanded: InputSignal<boolean> = input<boolean>(false);

  /**
   * Gets a value indicating whether only a picture the theme has for this name is drawn, not its
   * default: for a row that means more than its file does, such as a project.
   */
  public readonly named: InputSignal<boolean> = input<boolean>(false);

  /**
   * Gets the theme's picture, or undefined when Studio's own icon is drawn.
   */
  protected readonly picture: Signal<string | undefined> = computed((): string | undefined => {
    const path: string | null = this.path();
    return path === null
      ? undefined
      : this.themes.pictureFor({
          path,
          kind: this.kind(),
          expanded: this.expanded(),
          named: this.named(),
        });
  });
}
