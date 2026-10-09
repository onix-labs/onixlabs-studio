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
import { CdkMenuTrigger } from '@angular/cdk/menu';
import { Menu, MenuItem } from '@shared/angular/components/menu/menu';
import {
  DocumentFileCommands,
  injectDocumentFileCommands,
} from '@shared/angular/services/document-file-commands/document-file-commands';

/**
 * Identifies the strip menu's ways of opening the image.
 */
const MENU_OPEN_IN_TAB: string = 'image.openInTab';
const MENU_OPEN_IN_BINARY_EDITOR: string = 'image.openInBinaryEditor';
const MENU_OPEN_SOURCE: string = 'image.openSource';
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
  imports: [Button, CdkMenuTrigger, Menu],
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
   * Holds the file commands the menu ends with, shared with every document strip.
   */
  private readonly fileCommands: DocumentFileCommands = injectDocumentFileCommands();

  /**
   * Gets the menu's items: the other ways to open the image — its own tab, the binary editor, and its
   * markup for a vector image — then the file's commands.
   */
  protected readonly menuItems: Signal<readonly MenuItem[]> = computed((): readonly MenuItem[] => {
    const document: ImageDocument | undefined = this.document();
    return [
      { id: MENU_OPEN_IN_TAB, label: 'Open in Tab', icon: Icon.OPEN_EXTERNAL },
      { id: MENU_OPEN_IN_BINARY_EDITOR, label: 'Open in Binary Editor', icon: Icon.BINARY },
      ...(document?.isVector === true
        ? [{ id: MENU_OPEN_SOURCE, label: 'Open Source', icon: Icon.OPEN_SOURCE }]
        : []),
      { id: 'separator', label: '', separator: true },
      ...this.fileCommands.items(document?.path ?? null),
    ];
  });

  /**
   * Runs a command chosen from the strip's menu.
   * @param id The chosen item's identifier.
   */
  protected onMenu(id: string): void {
    const view: ImageView | undefined = this.view();
    switch (id) {
      case MENU_OPEN_IN_TAB:
        this.openInTab.emit();
        break;
      case MENU_OPEN_IN_BINARY_EDITOR:
        view?.openInBinaryEditor();
        break;
      case MENU_OPEN_SOURCE:
        view?.openSource();
        break;
      default:
        this.fileCommands.run(id, this.document()?.path ?? null);
        break;
    }
  }

  /**
   * Sets the view's backdrop.
   * @param background The backdrop to show.
   */
  protected setBackground(background: ImageBackground): void {
    this.view()?.background.set(background);
  }
}
