import { DOCUMENT } from '@angular/common';
import { inject, Service } from '@angular/core';
import { ViewportRuler } from '@angular/cdk/scrolling';

/**
 * A viewport ruler measuring the pop-out window it is provided in. The base ruler resolves its
 * document through injection — so a window-scoped instance already measures the pop-out — but it
 * CACHES the viewport size and invalidates the cache only on resize events, which it binds through
 * the root renderer to the MAIN window. A resized pop-out would keep serving its stale size to
 * overlay positioning, so this ruler measures the window afresh on every call instead.
 */
@Service()
export class PopoutViewportRuler extends ViewportRuler {
  /**
   * Holds the pop-out window's document.
   */
  private readonly popoutDocument: Document = inject(DOCUMENT);

  /**
   * Gets the pop-out window's current viewport size, measured live.
   * @returns Returns the viewport size.
   */
  public override getViewportSize(): Readonly<{ width: number; height: number }> {
    const view: Window | null = this.popoutDocument.defaultView;
    return view === null
      ? super.getViewportSize()
      : { width: view.innerWidth, height: view.innerHeight };
  }
}
