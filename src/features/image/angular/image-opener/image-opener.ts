import { inject, Service } from '@angular/core';
import { Icon } from '@shared/angular/icons/icon';
import { DockPanel } from '@shared/angular/services/dock-layout/dock-panel';
import { ImageFileOpener } from '@shared/angular/services/file-opener/image-file-opener';
import { Tab } from '@shared/angular/services/tabs/tab';
import { ImageDocument, ImageDocuments } from '../image-document/image-document';
import { ImageWellPanel } from '../image-well-panel/image-well-panel';

/**
 * Opens images for the shared file opener, in either home: a top-level image tab, or a panel in a
 * workspace's document well. Both hold the image through {@link ImageDocuments}, so the same file
 * open in both is one document.
 */
@Service()
export class ImageOpener implements ImageFileOpener {
  /**
   * Holds the shared image documents.
   */
  private readonly documents: ImageDocuments = inject(ImageDocuments);

  /**
   * Opens an image in a top-level image tab, reusing an existing tab for the same path.
   * @param path The absolute path of the image.
   * @returns Returns the opened, or re-activated, tab.
   */
  public open(path: string): Tab {
    return this.documents.openTab(path);
  }

  /**
   * Describes the well panel showing an image in a workspace, holding the image's document for it.
   * @param path The absolute path of the image.
   * @param ownerTabId The id of the workspace tab whose well the panel opens in.
   * @returns Returns the panel, its id stable for the pair.
   */
  public wellPanel(path: string, ownerTabId: string): DockPanel {
    const id: string = `image-well:${ownerTabId}:${path}`;
    const document: ImageDocument = this.documents.hold(id, ownerTabId, path);
    return {
      id,
      title: document.fileName,
      icon: Icon.IMAGE_FILE,
      role: 'document',
      component: ImageWellPanel,
      // The panel carries the image's own strip; the dock's stub strip would only duplicate it.
      ownsToolStrip: true,
      dirty: document.dirty,
      confirmClose: (): Promise<boolean> => this.documents.confirmClose(id),
    };
  }

  /**
   * Releases a well panel's hold on its image, once the panel has left the layout.
   * @param panelId The panel's id.
   */
  public releaseWellPanel(panelId: string): void {
    this.documents.releaseHolder(panelId);
  }
}
