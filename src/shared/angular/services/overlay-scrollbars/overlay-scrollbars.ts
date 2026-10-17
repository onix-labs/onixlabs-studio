import { DestroyRef, inject, Service } from '@angular/core';
import { ScrollbarLayer } from './scrollbar-layer';

/**
 * Floats scroll bars over the content of every scroll area, app-wide, rather than beside it, so a
 * row's full-width fill reaches the area's edge.
 *
 * Draws over the main window from the start, and over each child window (pop-out panels and modals)
 * from when {@link ChildWindowStyling} adopts it until it is released. The drawing itself is
 * {@link ScrollbarLayer}'s, one per document. A root singleton, instantiated by the shell for its effect.
 */
@Service()
export class OverlayScrollbars {
  /**
   * Holds the layer drawing over each document.
   */
  private readonly layers: Map<Document, ScrollbarLayer> = new Map<Document, ScrollbarLayer>();

  /**
   * Initializes a new instance of the {@link OverlayScrollbars} class, drawing over the main window
   * and stopping everywhere with the injector.
   */
  public constructor() {
    this.attach(document);
    inject(DestroyRef).onDestroy((): void => {
      for (const layer of this.layers.values()) {
        layer.dispose();
      }
      this.layers.clear();
    });
  }

  /**
   * Starts drawing over a document's scroll areas. A document already drawn over is left as it is,
   * and one with no window or body (detached, so never on screen) is ignored.
   * @param doc The document.
   */
  public attach(doc: Document): void {
    if (!this.layers.has(doc) && doc.defaultView !== null && doc.body !== null) {
      this.layers.set(doc, new ScrollbarLayer(doc));
    }
  }

  /**
   * Stops drawing over a document's scroll areas. A document not drawn over is ignored.
   * @param doc The document.
   */
  public detach(doc: Document): void {
    this.layers.get(doc)?.dispose();
    this.layers.delete(doc);
  }
}
