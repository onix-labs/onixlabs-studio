import { InjectionToken } from '@angular/core';
import { DockPanel } from '@shared/angular/services/dock-layout/dock-panel';
import { Tab } from '@shared/angular/services/tabs/tab';

/**
 * Describes the viewer that accepts the `kind: 'image'` classification the main process assigns by
 * extension. The image feature contributes its document registry through {@link IMAGE_FILE_OPENER};
 * the shared {@link import('./file-opener').FileOpener} routes images through the token, so it names
 * the classification without importing the feature. When no implementation is contributed (the
 * feature is absent), an image falls back to the binary editor, as it opened before the viewer existed.
 *
 * An image has two homes. Opened from the welcome screen, File ▸ Open or the recents, it is a
 * top-level tab; opened from a workspace's Solution Explorer, it is a document in that workspace's
 * well beside the code that references it. Both hosts share one document per file.
 */
export interface ImageFileOpener {
  /**
   * Opens an image in a top-level image tab, reusing an existing tab for the same path.
   * @param path The absolute path of the image to open.
   * @returns Returns the opened, or re-activated, tab.
   */
  open(path: string): Tab;

  /**
   * Describes the document-well panel that shows an image inside a workspace, holding the image's
   * document for that panel until {@link releaseWellPanel} is called with the panel's id.
   * @param path The absolute path of the image to open.
   * @param ownerTabId The id of the workspace tab whose well the panel opens in.
   * @returns Returns the panel to register with the workspace's dock; its id is stable for the pair,
   * so opening the same image in the same well again finds the existing panel.
   */
  wellPanel(path: string, ownerTabId: string): DockPanel;

  /**
   * Releases the hold a well panel has on its image's document, once the panel has left the layout.
   * The document itself is disposed when nothing else — a tab, or another well — still shows it.
   * @param panelId The id of the panel {@link wellPanel} described.
   */
  releaseWellPanel(panelId: string): void;
}

/**
 * Names the injection token the image feature contributes its file opener through.
 */
export const IMAGE_FILE_OPENER: InjectionToken<ImageFileOpener> =
  new InjectionToken<ImageFileOpener>('IMAGE_FILE_OPENER');
