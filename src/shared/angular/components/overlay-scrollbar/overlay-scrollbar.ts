import {
  afterRenderEffect,
  DestroyRef,
  Directive,
  ElementRef,
  inject,
  input,
  InputSignal,
} from '@angular/core';

/**
 * How long the thumb stays shown after the last scroll, in milliseconds.
 */
const LINGER_MS: number = 800;

/**
 * The shortest the thumb is drawn, in pixels, so a long list still leaves something to grab.
 */
const MIN_THUMB_PX: number = 24;

/**
 * The gap between the thumb and the top and bottom of the scroller, in pixels.
 */
const INSET_PX: number = 3;

/**
 * Floats a vertical scrollbar over a scroll container's content instead of beside it.
 *
 * Studio's scrollbars are custom-drawn (see `_base.scss`), but a native scrollbar of any style still
 * takes its width out of the content box, so a row's full-width fill — a selected row's accent — stops
 * short of the container's edge and leaves a channel beside it. Where that matters, this hides the
 * native bar and draws a thumb of its own over the content: the same slim pill, revealed the same way
 * (while the pointer is over the area or it is scrolling), draggable, and absent when nothing
 * overflows.
 *
 * Put it on the element the thumb should be positioned in — it becomes `position: relative` — naming
 * the scroll container inside it by selector, or leaving the selector empty when the element itself
 * scrolls.
 */
@Directive({
  selector: '[appOverlayScrollbar]',
  host: {
    class: 'overlay-scrollbar',
    '(pointerenter)': 'hovering = true; refresh()',
    '(pointerleave)': 'hovering = false; refresh()',
  },
})
export class OverlayScrollbar {
  /**
   * Gets the selector of the scroll container within the host, or empty when the host scrolls.
   */
  public readonly appOverlayScrollbar: InputSignal<string> = input<string>('');

  /**
   * Holds the host element.
   */
  private readonly host: HTMLElement = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  /**
   * Holds the thumb, drawn over the content.
   */
  private readonly thumb: HTMLElement = this.host.ownerDocument.createElement('div');

  /**
   * Holds the scroll container the thumb follows, or null until it renders.
   */
  private scroller: HTMLElement | null = null;

  /**
   * Holds the observer re-measuring when the scroller or its content changes size.
   */
  private readonly resize: ResizeObserver | null = ((): ResizeObserver | null => {
    // Built from the host's own window: a modal is a child window (its document is not the main one),
    // and an observer from another realm is the kind of thing that works until it does not.
    const realm: (Window & typeof globalThis) | null = this.host.ownerDocument.defaultView;
    const Observer: typeof ResizeObserver | undefined = realm?.ResizeObserver;
    return Observer === undefined ? null : new Observer((): void => this.refresh());
  })();

  /**
   * Holds the timer hiding the thumb after scrolling stops.
   */
  private lingering: ReturnType<typeof setTimeout> | null = null;

  /**
   * Holds the pointer dragging the thumb, and where the drag started.
   */
  private drag: { readonly pointerId: number; readonly y: number; readonly top: number } | null =
    null;

  /**
   * Holds whether the pointer is over the host.
   */
  protected hovering: boolean = false;

  /**
   * Holds whether the scroller is mid-scroll.
   */
  private scrolling: boolean = false;

  /**
   * Initializes a new instance of the {@link OverlayScrollbar} class: adds the thumb, and follows the
   * scroll container once it has rendered — again whenever it is replaced.
   */
  public constructor() {
    this.thumb.className = 'overlay-scrollbar__thumb';
    this.thumb.setAttribute('aria-hidden', 'true');
    this.host.appendChild(this.thumb);
    this.thumb.addEventListener('pointerdown', this.onPointerDown);
    this.thumb.addEventListener('pointermove', this.onPointerMove);
    this.thumb.addEventListener('pointerup', this.onPointerUp);
    this.thumb.addEventListener('pointercancel', this.onPointerUp);

    afterRenderEffect((): void => {
      const selector: string = this.appOverlayScrollbar();
      const found: HTMLElement | null =
        selector.length === 0 ? this.host : this.host.querySelector<HTMLElement>(selector);
      if (found !== this.scroller) {
        this.follow(found);
      }
      this.refresh();
    });

    inject(DestroyRef).onDestroy((): void => {
      this.follow(null);
      this.resize?.disconnect();
      if (this.lingering !== null) {
        clearTimeout(this.lingering);
      }
      this.thumb.remove();
    });
  }

  /**
   * Re-measures and redraws the thumb: its length from how much of the content is visible, its place
   * from how far it is scrolled, and whether it shows at all.
   */
  public refresh(): void {
    const scroller: HTMLElement | null = this.scroller;
    const visible: number = scroller?.clientHeight ?? 0;
    const content: number = scroller?.scrollHeight ?? 0;
    if (scroller === null || content <= visible || visible === 0) {
      this.thumb.hidden = true;
      return;
    }
    const track: number = visible - INSET_PX * 2;
    const length: number = Math.max(MIN_THUMB_PX, Math.round((track * visible) / content));
    const travel: number = track - length;
    const offset: number = Math.round(
      (scroller.scrollTop / (content - visible)) * Math.max(0, travel),
    );
    this.thumb.hidden = false;
    this.thumb.style.top = `${scroller.offsetTop + INSET_PX + offset}px`;
    this.thumb.style.height = `${length}px`;
    this.thumb.classList.toggle(
      'overlay-scrollbar__thumb--shown',
      this.hovering || this.scrolling || this.drag !== null,
    );
  }

  /**
   * Starts following a scroll container, and stops following the last.
   * @param scroller The container, or null for none.
   */
  private follow(scroller: HTMLElement | null): void {
    if (this.scroller !== null) {
      this.scroller.removeEventListener('scroll', this.onScroll);
      this.scroller.classList.remove('overlay-scrollbar__scroller');
      this.resize?.unobserve(this.scroller);
      if (this.scroller.firstElementChild !== null) {
        this.resize?.unobserve(this.scroller.firstElementChild);
      }
    }
    this.scroller = scroller;
    if (scroller !== null) {
      scroller.addEventListener('scroll', this.onScroll, { passive: true });
      scroller.classList.add('overlay-scrollbar__scroller');
      this.resize?.observe(scroller);
      if (scroller.firstElementChild !== null) {
        this.resize?.observe(scroller.firstElementChild);
      }
    }
  }

  /**
   * Shows the thumb while scrolling, and for a moment after.
   */
  private readonly onScroll: () => void = (): void => {
    this.scrolling = true;
    if (this.lingering !== null) {
      clearTimeout(this.lingering);
    }
    this.lingering = setTimeout((): void => {
      this.scrolling = false;
      this.lingering = null;
      this.refresh();
    }, LINGER_MS);
    this.refresh();
  };

  /**
   * Starts dragging the thumb.
   * @param event The pointer event.
   */
  private readonly onPointerDown: (event: PointerEvent) => void = (event: PointerEvent): void => {
    if (this.scroller === null || event.button !== 0) {
      return;
    }
    event.preventDefault();
    this.thumb.setPointerCapture?.(event.pointerId);
    this.drag = { pointerId: event.pointerId, y: event.clientY, top: this.scroller.scrollTop };
    this.refresh();
  };

  /**
   * Scrolls by as much as the thumb has been dragged, scaled from the track to the content.
   * @param event The pointer event.
   */
  private readonly onPointerMove: (event: PointerEvent) => void = (event: PointerEvent): void => {
    const scroller: HTMLElement | null = this.scroller;
    if (this.drag === null || scroller === null || event.pointerId !== this.drag.pointerId) {
      return;
    }
    const track: number = scroller.clientHeight - INSET_PX * 2;
    const travel: number = track - this.thumb.offsetHeight;
    const range: number = scroller.scrollHeight - scroller.clientHeight;
    if (travel > 0) {
      scroller.scrollTop = this.drag.top + ((event.clientY - this.drag.y) * range) / travel;
    }
  };

  /**
   * Ends dragging the thumb.
   * @param event The pointer event.
   */
  private readonly onPointerUp: (event: PointerEvent) => void = (event: PointerEvent): void => {
    if (this.drag?.pointerId === event.pointerId) {
      this.thumb.releasePointerCapture?.(event.pointerId);
      this.drag = null;
      this.refresh();
    }
  };
}
