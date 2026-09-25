import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  InputSignal,
  output,
  OutputEmitterRef,
  Signal,
} from '@angular/core';
import { Button } from '@shared/angular/components/forms/button/button';
import { Icon } from '@shared/angular/icons/icon';
import { ImageDocument } from '../image-document/image-document';
import { ImageBackground, ImageView } from '../image-view/image-view';

/**
 * Represents the tool strip an image in a workspace's document well carries in place of the ribbon a
 * tab gets: the well sits inside the workspace tab, whose ribbon is the workspace's, so the image's
 * own commands — save, undo, zoom, backdrop, the edits, export — ride along the top of the image.
 */
@Component({
  selector: 'app-image-toolstrip',
  imports: [Button],
  templateUrl: './image-toolstrip.html',
  styleUrl: './image-toolstrip.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ImageToolstrip {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the view the strip drives, or undefined before it has rendered.
   */
  public readonly view: InputSignal<ImageView | undefined> = input<ImageView>();

  /**
   * Raised when the user asks to open the image in its own tab.
   */
  public readonly openInTab: OutputEmitterRef<void> = output<void>();

  /**
   * Gets the document the view shows.
   */
  protected readonly document: Signal<ImageDocument | undefined> = computed(
    (): ImageDocument | undefined => this.view()?.document(),
  );

  /**
   * Gets a value indicating whether the raster edits apply.
   */
  protected readonly canEdit: Signal<boolean> = computed(
    (): boolean => this.document()?.canEdit() ?? false,
  );

  /**
   * Gets the view's backdrop.
   */
  protected readonly background: Signal<ImageBackground> = computed(
    (): ImageBackground => this.view()?.background() ?? 'checker',
  );

  /**
   * Sets the view's backdrop.
   * @param background The backdrop to show.
   */
  protected setBackground(background: ImageBackground): void {
    this.view()?.background.set(background);
  }
}
