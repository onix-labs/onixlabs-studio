import { DOCUMENT } from '@angular/common';
import { DestroyRef, inject, Service, Signal, signal, WritableSignal } from '@angular/core';

/**
 * Tells whether the window this document belongs to is on screen: not minimised, not hidden behind
 * another window on every monitor, not on another desktop. A view that keeps a live feed running
 * while it shows — the System Monitor's sampling, the Containers view's stats, a log stream — ANDs
 * this into its "showing" condition, so the feed stops when nobody can see the window and resumes
 * when it comes back (audit P4). A tab's own activity says only which tab is in front; it stays
 * "active" while Studio sits behind another app all afternoon.
 *
 * Read from the document's `visibilityState`, which Chromium keeps up to date for a minimised,
 * hidden or fully occluded window; a visible window that merely lacks focus still counts as visible,
 * since a monitor on a second screen is watched without being focused. Resolved against the
 * injector's document, so a window-scoped injector answers for its own window.
 */
@Service()
export class DocumentVisibility {
  /**
   * Holds the document whose visibility is reported.
   */
  private readonly document: Document = inject(DOCUMENT);

  /**
   * Holds whether the document is currently visible.
   */
  private readonly state: WritableSignal<boolean> = signal<boolean>(this.read());

  /**
   * Gets whether the window is on screen.
   */
  public readonly visible: Signal<boolean> = this.state.asReadonly();

  /**
   * Follows the document's visibility for as long as the injector lives.
   */
  public constructor() {
    const update: () => void = (): void => this.state.set(this.read());
    this.document.addEventListener('visibilitychange', update);
    inject(DestroyRef).onDestroy((): void =>
      this.document.removeEventListener('visibilitychange', update),
    );
  }

  /**
   * Reads the document's current visibility. A document with no visibility state (an unusual host)
   * is taken as visible, so a feed is never stopped on a guess.
   * @returns Returns true when the document is visible.
   */
  private read(): boolean {
    return this.document.visibilityState !== 'hidden';
  }
}
