import { Service, signal, WritableSignal } from '@angular/core';
import type { ImageView } from '../image-view/image-view';

/**
 * Tracks the image views standing as top-level tabs, keyed by tab id, so the contextual ribbon —
 * which mounts in the shell's injector, not the view's — can drive the active tab's view: its zoom,
 * background and editing tools belong to the view rather than the shared document.
 */
@Service()
export class ImageViews {
  /**
   * Holds the registered views, replaced on every change so readers re-evaluate.
   */
  private readonly views: WritableSignal<ReadonlyMap<string, ImageView>> = signal<
    ReadonlyMap<string, ImageView>
  >(new Map<string, ImageView>());

  /**
   * Registers a tab's view.
   * @param tabId The tab's identifier.
   * @param view The view.
   */
  public register(tabId: string, view: ImageView): void {
    this.views.update((views: ReadonlyMap<string, ImageView>): ReadonlyMap<string, ImageView> =>
      new Map<string, ImageView>(views).set(tabId, view),
    );
  }

  /**
   * Unregisters a tab's view, when that view is the one registered.
   * @param tabId The tab's identifier.
   * @param view The view being destroyed.
   */
  public unregister(tabId: string, view: ImageView): void {
    if (this.views().get(tabId) !== view) {
      return;
    }
    this.views.update((views: ReadonlyMap<string, ImageView>): ReadonlyMap<string, ImageView> => {
      const next: Map<string, ImageView> = new Map<string, ImageView>(views);
      next.delete(tabId);
      return next;
    });
  }

  /**
   * Gets a tab's view.
   * @param tabId The tab's identifier, or undefined.
   * @returns Returns the view, or undefined when the tab has none.
   */
  public get(tabId: string | undefined): ImageView | undefined {
    return tabId === undefined ? undefined : this.views().get(tabId);
  }
}
