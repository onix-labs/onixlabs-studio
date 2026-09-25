import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { MENU_SEPARATOR, MenuContribution } from '@shared/angular/services/app-menu/app-menu-model';
import { contributeFeatureMenu } from '@shared/angular/services/app-menu/contribute-feature-menu';
import { Icon } from '@shared/angular/icons/icon';
import { RibbonHost } from '@shared/angular/components/ribbon-strip/ribbon-host/ribbon-host';
import { RibbonStripButton } from '@shared/angular/components/ribbon-strip/ribbon-strip-button/ribbon-strip-button';
import { RibbonStripButtonSmall } from '@shared/angular/components/ribbon-strip/ribbon-strip-button-small/ribbon-strip-button-small';
import { RibbonStripColumn } from '@shared/angular/components/ribbon-strip/ribbon-strip-column/ribbon-strip-column';
import { RibbonStripGroup } from '@shared/angular/components/ribbon-strip/ribbon-strip-group/ribbon-strip-group';
import { RibbonStripOverflow } from '@shared/angular/components/ribbon-strip/ribbon-strip-overflow/ribbon-strip-overflow';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import { ImageDocument } from '../image-document/image-document';
import { ImageBackground, ImageTool, ImageView } from '../image-view/image-view';
import { ImageViews } from '../image-views/image-views';

/**
 * Represents the contextual ribbon shown when an image tab is active. It resolves the active tab's
 * {@link ImageView} from the {@link ImageViews} registry (the ribbon mounts in the shell, not the
 * view) and drives its zoom, backdrop and tools, and the document's edits and saving.
 */
@Component({
  selector: 'app-image-ribbon',
  imports: [
    RibbonStripOverflow,
    RibbonStripGroup,
    RibbonStripButton,
    RibbonStripButtonSmall,
    RibbonStripColumn,
  ],
  templateUrl: './image-ribbon.html',
  hostDirectives: [RibbonHost],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ImageRibbon {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the tab registry, used to resolve the active image tab.
   */
  private readonly tabs: Tabs = inject(Tabs);

  /**
   * Holds the registry of image tab views.
   */
  private readonly views: ImageViews = inject(ImageViews);

  /**
   * Gets the active tab's view, or undefined when no image tab is active.
   */
  protected readonly view: Signal<ImageView | undefined> = computed((): ImageView | undefined =>
    this.views.get(this.tabs.activeTabId()),
  );

  /**
   * Gets the active view's document.
   */
  protected readonly document: Signal<ImageDocument | undefined> = computed(
    (): ImageDocument | undefined => this.view()?.document(),
  );

  /**
   * Gets whether the image has unsaved edits, enabling Save.
   */
  protected readonly dirty: Signal<boolean> = computed(
    (): boolean => this.document()?.dirty() ?? false,
  );

  /**
   * Gets whether there is an edit to undo.
   */
  protected readonly canUndo: Signal<boolean> = computed(
    (): boolean => this.document()?.canUndo() ?? false,
  );

  /**
   * Gets whether there is an undone edit to redo.
   */
  protected readonly canRedo: Signal<boolean> = computed(
    (): boolean => this.document()?.canRedo() ?? false,
  );

  /**
   * Gets whether the raster edits apply (not for an SVG, nor before the image has decoded).
   */
  protected readonly canEdit: Signal<boolean> = computed(
    (): boolean => this.document()?.canEdit() ?? false,
  );

  /**
   * Gets whether the image is an SVG, which offers its source to open as text.
   */
  protected readonly isVector: Signal<boolean> = computed(
    (): boolean => this.document()?.isVector ?? false,
  );

  /**
   * Gets the open tool.
   */
  protected readonly tool: Signal<ImageTool> = computed(
    (): ImageTool => this.view()?.tool() ?? 'none',
  );

  /**
   * Gets whether the image is fitted to the window.
   */
  protected readonly fitted: Signal<boolean> = computed(
    (): boolean => this.view()?.isFitted() ?? false,
  );

  /**
   * Gets the backdrop.
   */
  protected readonly background: Signal<ImageBackground> = computed(
    (): ImageBackground => this.view()?.background() ?? 'checker',
  );

  /**
   * Contributes the image's commands to the application menu while an image tab is active. No
   * accelerators are declared: the view's catalogued chords serve them, and a native accelerator
   * would fire the command a second time.
   */
  private readonly menu: void = contributeFeatureMenu('image', (): readonly MenuContribution[] => [
    {
      id: 'image',
      label: 'Image',
      items: [
        { id: 'image.zoomIn', label: 'Zoom In', run: (): void => this.view()?.zoomIn() },
        { id: 'image.zoomOut', label: 'Zoom Out', run: (): void => this.view()?.zoomOut() },
        {
          id: 'image.actualSize',
          label: 'Actual Size',
          run: (): void => this.view()?.actualSize(),
        },
        {
          id: 'image.fit',
          label: 'Fit to Window',
          kind: 'checkbox',
          checked: this.fitted(),
          run: (): void => this.view()?.fit(),
        },
        MENU_SEPARATOR,
        {
          id: 'image.rotateLeft',
          label: 'Rotate Left',
          enabled: this.canEdit(),
          run: (): void => this.view()?.rotate(false),
        },
        {
          id: 'image.rotateRight',
          label: 'Rotate Right',
          enabled: this.canEdit(),
          run: (): void => this.view()?.rotate(true),
        },
        {
          id: 'image.flipHorizontal',
          label: 'Flip Horizontal',
          enabled: this.canEdit(),
          run: (): void => this.view()?.flip('horizontal'),
        },
        {
          id: 'image.flipVertical',
          label: 'Flip Vertical',
          enabled: this.canEdit(),
          run: (): void => this.view()?.flip('vertical'),
        },
        MENU_SEPARATOR,
        {
          id: 'image.exportAs',
          label: 'Export As…',
          run: (): void => this.view()?.toggleTool('export'),
        },
        {
          id: 'image.openInBinaryEditor',
          label: 'Open in Binary Editor',
          run: (): void => this.view()?.openInBinaryEditor(),
        },
      ],
    },
  ]);

  /**
   * Sets the active view's backdrop.
   * @param background The backdrop to show.
   */
  protected setBackground(background: ImageBackground): void {
    this.view()?.background.set(background);
  }
}
