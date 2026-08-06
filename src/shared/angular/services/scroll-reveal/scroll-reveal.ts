import { DestroyRef, inject, Service } from '@angular/core';

/**
 * How long after the last scroll a container keeps its revealed scrollbar before it fades back to
 * hidden. Long enough that a continuous wheel/keyboard scroll never flickers, short enough that the bar
 * does not linger once the gesture ends.
 */
const SCROLL_IDLE_MS: number = 800;

/**
 * Reveals custom scrollbars while a container is actively scrolling, complementing the hover reveal the
 * stylesheet handles on its own.
 *
 * The app draws its own scrollbars (see `_base.scss`) so they no longer flip between the native macOS
 * overlay and its chunky persistent gutter. Those custom bars stay hidden at rest and reveal on
 * `:hover`, but a wheel, keyboard, or programmatic scroll of an area the pointer is not over (a new
 * agent message auto-scrolling into view, say) would otherwise show nothing. This marks the scrolled
 * element with `data-app-scrolling` for a short window after each scroll, which the stylesheet keys the
 * reveal off, mimicking the macOS overlay's scroll flash.
 *
 * A single capture-phase listener on the document catches every descendant's scroll (the event does not
 * bubble, so a capture listener is the only way to observe them all from one place). It is a root
 * singleton, instantiated by the shell for its effect.
 */
@Service()
export class ScrollReveal {
  /**
   * Holds the pending fade-out timer for each scrolling element, so a continuing scroll resets it
   * rather than letting the bar hide mid-gesture. Keyed weakly so a removed element is not retained.
   */
  private readonly timers: WeakMap<HTMLElement, ReturnType<typeof setTimeout>> = new WeakMap<
    HTMLElement,
    ReturnType<typeof setTimeout>
  >();

  /**
   * Initializes a new instance of the {@link ScrollReveal} class, listening for scrolls across the
   * whole document and tearing the listener down with the injector.
   */
  public constructor() {
    const onScroll: (event: Event) => void = (event: Event): void => this.mark(event.target);
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    inject(DestroyRef).onDestroy((): void => {
      document.removeEventListener('scroll', onScroll, { capture: true });
    });
  }

  /**
   * Marks a scrolled element as scrolling and schedules its return to hidden, resetting any pending
   * timer so a continuous scroll holds the bar open. Ignores non-element targets (the document itself).
   * @param target The scroll event's target.
   */
  private mark(target: EventTarget | null): void {
    if (!(target instanceof HTMLElement)) {
      return;
    }
    // Set the attribute only when absent so a rapid stream of scroll events does not re-invalidate the
    // element's style on every frame; the timer reset below is what keeps the reveal alive.
    if (!target.hasAttribute('data-app-scrolling')) {
      target.setAttribute('data-app-scrolling', '');
    }
    const pending: ReturnType<typeof setTimeout> | undefined = this.timers.get(target);
    if (pending !== undefined) {
      clearTimeout(pending);
    }
    this.timers.set(
      target,
      setTimeout((): void => {
        target.removeAttribute('data-app-scrolling');
        this.timers.delete(target);
      }, SCROLL_IDLE_MS),
    );
  }
}
