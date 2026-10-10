/**
 * How long a scroll area's bars stay shown after its last scroll, in milliseconds. Long enough that a
 * continuous wheel or keyboard scroll never flickers, short enough that the bars do not linger.
 */
const LINGER_MS: number = 800;

/**
 * How long a hidden area's bars are kept after they fade, in milliseconds, before they are taken away.
 * Outlasts the stylesheet's fade, so the bars are never removed while still visible.
 */
const REMOVE_MS: number = 250;

/**
 * The shortest a thumb is drawn, in pixels, so a long list still leaves something to grab.
 */
const MIN_THUMB_PX: number = 24;

/**
 * The gap between a thumb and the ends of its track, in pixels.
 */
const INSET_PX: number = 3;

/**
 * How much of each track is given up where both bars show, in pixels, so the thumbs never meet in the
 * corner.
 */
const CORNER_PX: number = 8;

/**
 * The overflow values that let an element scroll.
 */
const SCROLLING_OVERFLOW: ReadonlySet<string> = new Set<string>(['auto', 'scroll', 'overlay']);

/**
 * The CSS custom property a scroll area sets to `none` to have no bar drawn over it at all (a tab strip
 * that scrolls sideways but has no room for one, say). Registered as non-inherited in `_base.scss`, so
 * it reaches only the element that sets it.
 */
const OPT_OUT_PROPERTY: string = '--app-scrollbar';

/**
 * The axis a thumb scrolls along.
 */
type Axis = 'vertical' | 'horizontal';

/**
 * A rectangle in the document's viewport coordinates.
 */
interface Box {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/**
 * The pointer dragging a thumb, and where the drag started.
 */
interface Drag {
  readonly axis: Axis;
  readonly pointerId: number;
  readonly start: number;
  readonly scroll: number;
}

/**
 * The bars drawn over one scroll area.
 */
interface Bars {
  /**
   * The scroll area.
   */
  readonly scroller: HTMLElement;

  /**
   * The part of the area that is visible, clipping the thumbs to it.
   */
  readonly frame: HTMLElement;

  /**
   * The area's padding box, the thumbs' positioning context.
   */
  readonly box: HTMLElement;

  /**
   * The thumb for scrolling down.
   */
  readonly vertical: HTMLElement;

  /**
   * The thumb for scrolling across.
   */
  readonly horizontal: HTMLElement;

  /**
   * The area's ancestors that clip it, so a thumb is never drawn over what the area cannot show.
   */
  readonly clips: readonly HTMLElement[];

  /**
   * Whether the area is mid-scroll.
   */
  scrolling: boolean;

  /**
   * The timer ending the scroll reveal, or null when not scrolling.
   */
  lingering: ReturnType<typeof setTimeout> | null;

  /**
   * The timer taking the hidden bars away, or null while they show.
   */
  removing: ReturnType<typeof setTimeout> | null;

  /**
   * The drag in progress, or null.
   */
  drag: Drag | null;
}

/**
 * Floats scroll bars over the content of every scroll area in one document, rather than beside it.
 *
 * `_base.scss` hides every native scroll bar, because any native bar, however it is styled, takes its
 * width out of the content box: a selected row's fill would stop short of the area's edge and leave a
 * channel. This draws the bars instead, in a layer over the whole document. They are slim pills,
 * hidden at rest and shown while the pointer is over the area or while it scrolls (by wheel, keyboard,
 * or code), as the macOS overlay bars are. They can be dragged, and are absent when nothing overflows.
 *
 * Scroll areas are found as they are needed, not registered: the pointer's way up the DOM names the
 * areas it is over, and a scroll event names the area that moved. So an area added later, in any view
 * or component, is covered without doing anything. Monaco and xterm draw their own bars and do not
 * scroll natively, so none of this reaches editor or terminal content.
 */
export class ScrollbarLayer {
  /**
   * Holds the document's window, whose timers, frames and observers the layer uses.
   */
  private readonly view: Window & typeof globalThis;

  /**
   * Holds the layer, over the whole document, the bars are drawn in.
   */
  private readonly root: HTMLElement;

  /**
   * Holds the bars currently drawn, by the area they are drawn over.
   */
  private readonly bars: Map<HTMLElement, Bars> = new Map<HTMLElement, Bars>();

  /**
   * Holds the bars each thumb belongs to, so a thumb's events find their area.
   */
  private readonly owners: WeakMap<Element, Bars> = new WeakMap<Element, Bars>();

  /**
   * Holds the observer redrawing when an area or its content changes size, or null where the window
   * has none.
   */
  private readonly resize: ResizeObserver | null;

  /**
   * Holds the scroll areas the pointer is over, innermost first.
   */
  private hovered: readonly HTMLElement[] = [];

  /**
   * Holds the element the pointer was last over, so moving within it does not walk the DOM again.
   */
  private target: EventTarget | null = null;

  /**
   * Holds whether a redraw is waiting for the next frame.
   */
  private pending: boolean = false;

  /**
   * Initializes a new instance of the {@link ScrollbarLayer} class, drawing over a document.
   * @param doc The document whose scroll areas get bars.
   */
  public constructor(private readonly doc: Document) {
    this.view = doc.defaultView!;
    this.root = doc.createElement('div');
    this.root.className = 'app-scrollbars';
    this.root.setAttribute('aria-hidden', 'true');
    doc.body.appendChild(this.root);

    // Built from the document's own window: a modal is a child window, and an observer from another
    // realm is the kind of thing that works until it does not.
    const Observer: typeof ResizeObserver | undefined = this.view.ResizeObserver;
    this.resize = Observer === undefined ? null : new Observer((): void => this.schedule());

    doc.addEventListener('pointermove', this.onPointerMove, { capture: true, passive: true });
    doc.addEventListener('pointerout', this.onPointerOut, { capture: true, passive: true });
    doc.addEventListener('scroll', this.onScroll, { capture: true, passive: true });
    this.root.addEventListener('pointerdown', this.onPointerDown);
    this.root.addEventListener('pointermove', this.onDragMove);
    this.root.addEventListener('pointerup', this.onDragEnd);
    this.root.addEventListener('pointercancel', this.onDragEnd);
    this.root.addEventListener('wheel', this.onWheel, { passive: false });
    this.view.addEventListener('resize', this.onResize);
  }

  /**
   * Stops drawing: removes the layer and every listener, and cancels every timer.
   */
  public dispose(): void {
    this.doc.removeEventListener('pointermove', this.onPointerMove, { capture: true });
    this.doc.removeEventListener('pointerout', this.onPointerOut, { capture: true });
    this.doc.removeEventListener('scroll', this.onScroll, { capture: true });
    this.view.removeEventListener('resize', this.onResize);
    this.resize?.disconnect();
    for (const bars of [...this.bars.values()]) {
      this.remove(bars);
    }
    this.root.remove();
  }

  /**
   * Redraws every area's bars now: shows the ones the pointer is over or that are scrolling, sizes
   * and places them, and hides the rest.
   */
  public update(): void {
    this.pending = false;
    const hovered: ReadonlySet<HTMLElement> = new Set<HTMLElement>(this.hovered);
    for (const bars of [...this.bars.values()]) {
      if (!bars.scroller.isConnected) {
        this.remove(bars);
        continue;
      }
      const shown: boolean = hovered.has(bars.scroller) || bars.scrolling || bars.drag !== null;
      bars.frame.classList.toggle('app-scrollbars__frame--shown', shown);
      if (shown) {
        this.cancelRemoval(bars);
        this.place(bars);
      } else {
        bars.removing ??= setTimeout((): void => this.remove(bars), REMOVE_MS);
      }
    }
  }

  /**
   * Redraws on the next frame, once however many events ask for it.
   */
  private schedule(): void {
    if (this.pending) {
      return;
    }
    this.pending = true;
    this.view.requestAnimationFrame((): void => this.update());
  }

  /**
   * Notes the scroll areas the pointer is over whenever it moves onto another element.
   * @param event The pointer event.
   */
  private readonly onPointerMove: (event: PointerEvent) => void = (event: PointerEvent): void => {
    if (event.target !== this.target) {
      this.target = event.target;
      // Over a thumb, the pointer is still over that thumb's area, though not inside it.
      if (this.ownerOf(event.target) === undefined) {
        this.hovered = this.scrollersAround(event.target);
        for (const scroller of this.hovered) {
          this.barsFor(scroller);
        }
      }
    }
    if (this.bars.size > 0) {
      this.schedule();
    }
  };

  /**
   * Forgets the hovered areas when the pointer leaves the window.
   * @param event The pointer event.
   */
  private readonly onPointerOut: (event: PointerEvent) => void = (event: PointerEvent): void => {
    if (event.relatedTarget === null) {
      this.target = null;
      this.hovered = [];
      this.schedule();
    }
  };

  /**
   * Shows an area's bars while it scrolls, and for a moment after; and moves every other area's bars,
   * since an outer area scrolling carries the areas within it.
   * @param event The scroll event.
   */
  private readonly onScroll: (event: Event) => void = (event: Event): void => {
    const target: EventTarget | null = event.target;
    if (target instanceof this.view.HTMLElement && this.scrolls(target)) {
      const bars: Bars = this.barsFor(target);
      bars.scrolling = true;
      if (bars.lingering !== null) {
        clearTimeout(bars.lingering);
      }
      bars.lingering = setTimeout((): void => {
        bars.scrolling = false;
        bars.lingering = null;
        this.schedule();
      }, LINGER_MS);
    }
    if (this.bars.size > 0) {
      this.schedule();
    }
  };

  /**
   * Redraws when the window changes size.
   */
  private readonly onResize: () => void = (): void => {
    if (this.bars.size > 0) {
      this.schedule();
    }
  };

  /**
   * Starts dragging a thumb.
   * @param event The pointer event.
   */
  private readonly onPointerDown: (event: PointerEvent) => void = (event: PointerEvent): void => {
    const bars: Bars | undefined = this.ownerOf(event.target);
    if (bars === undefined || event.button !== 0) {
      return;
    }
    event.preventDefault();
    const axis: Axis = event.target === bars.vertical ? 'vertical' : 'horizontal';
    const thumb: HTMLElement = axis === 'vertical' ? bars.vertical : bars.horizontal;
    thumb.setPointerCapture?.(event.pointerId);
    bars.drag =
      axis === 'vertical'
        ? {
            axis,
            pointerId: event.pointerId,
            start: event.clientY,
            scroll: bars.scroller.scrollTop,
          }
        : {
            axis,
            pointerId: event.pointerId,
            start: event.clientX,
            scroll: bars.scroller.scrollLeft,
          };
    this.update();
  };

  /**
   * Scrolls by as much as a thumb has been dragged, scaled from the track to the content.
   * @param event The pointer event.
   */
  private readonly onDragMove: (event: PointerEvent) => void = (event: PointerEvent): void => {
    const bars: Bars | undefined = this.ownerOf(event.target);
    const drag: Drag | null | undefined = bars?.drag;
    if (bars === undefined || drag?.pointerId !== event.pointerId) {
      return;
    }
    const scroller: HTMLElement = bars.scroller;
    if (drag.axis === 'vertical') {
      const travel: number = this.track(bars, 'vertical') - bars.vertical.offsetHeight;
      const range: number = scroller.scrollHeight - scroller.clientHeight;
      if (travel > 0) {
        scroller.scrollTop = drag.scroll + ((event.clientY - drag.start) * range) / travel;
      }
    } else {
      const travel: number = this.track(bars, 'horizontal') - bars.horizontal.offsetWidth;
      const range: number = scroller.scrollWidth - scroller.clientWidth;
      if (travel > 0) {
        scroller.scrollLeft = drag.scroll + ((event.clientX - drag.start) * range) / travel;
      }
    }
  };

  /**
   * Ends dragging a thumb.
   * @param event The pointer event.
   */
  private readonly onDragEnd: (event: PointerEvent) => void = (event: PointerEvent): void => {
    const bars: Bars | undefined = this.ownerOf(event.target);
    if (bars?.drag?.pointerId === event.pointerId) {
      const thumb: HTMLElement = event.target === bars.vertical ? bars.vertical : bars.horizontal;
      thumb.releasePointerCapture?.(event.pointerId);
      bars.drag = null;
      this.schedule();
    }
  };

  /**
   * Scrolls an area when the wheel turns over its thumb. The thumb lies outside the area, so the
   * wheel would otherwise scroll nothing.
   * @param event The wheel event.
   */
  private readonly onWheel: (event: WheelEvent) => void = (event: WheelEvent): void => {
    const bars: Bars | undefined = this.ownerOf(event.target);
    if (bars === undefined) {
      return;
    }
    event.preventDefault();
    const scale: number =
      event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? bars.scroller.clientHeight : 1;
    bars.scroller.scrollBy({ left: event.deltaX * scale, top: event.deltaY * scale });
  };

  /**
   * Gets the bars a thumb belongs to. Looked up rather than tested with `instanceof`, which fails
   * across windows: a modal's elements are not the main window's `Element`.
   * @param target The event target.
   * @returns Returns the bars, or undefined when the target is not a thumb.
   */
  private ownerOf(target: EventTarget | null): Bars | undefined {
    return target === null ? undefined : this.owners.get(target as Element);
  }

  /**
   * Finds the scroll areas an element is within, itself included, innermost first.
   * @param target The element.
   * @returns Returns the areas.
   */
  private scrollersAround(target: EventTarget | null): HTMLElement[] {
    const found: HTMLElement[] = [];
    let element: Element | null = target instanceof this.view.Element ? target : null;
    while (element !== null && element !== this.doc.body && element !== this.doc.documentElement) {
      if (element instanceof this.view.HTMLElement && this.scrolls(element)) {
        found.push(element);
      }
      element = element.parentElement;
    }
    return found;
  }

  /**
   * Gets whether an element is a scroll area with somewhere to scroll to, and has not asked for no
   * bars.
   * @param element The element.
   * @returns Returns true if it gets bars.
   */
  private scrolls(element: HTMLElement): boolean {
    const overflowsY: boolean = element.scrollHeight > element.clientHeight;
    const overflowsX: boolean = element.scrollWidth > element.clientWidth;
    // Layout is read first: it is cheap, and rules out nearly every element without a style lookup.
    if (!overflowsY && !overflowsX) {
      return false;
    }
    const style: CSSStyleDeclaration = this.view.getComputedStyle(element);
    if (style.getPropertyValue(OPT_OUT_PROPERTY).trim() === 'none') {
      return false;
    }
    return (
      (overflowsY && SCROLLING_OVERFLOW.has(style.overflowY)) ||
      (overflowsX && SCROLLING_OVERFLOW.has(style.overflowX))
    );
  }

  /**
   * Gets an area's bars, drawing them if it has none yet.
   * @param scroller The area.
   * @returns Returns its bars.
   */
  private barsFor(scroller: HTMLElement): Bars {
    const existing: Bars | undefined = this.bars.get(scroller);
    if (existing !== undefined) {
      return existing;
    }
    const frame: HTMLElement = this.element('app-scrollbars__frame', this.root);
    const box: HTMLElement = this.element('app-scrollbars__box', frame);
    const bars: Bars = {
      scroller,
      frame,
      box,
      vertical: this.element('app-scrollbars__thumb app-scrollbars__thumb--vertical', box),
      horizontal: this.element('app-scrollbars__thumb app-scrollbars__thumb--horizontal', box),
      clips: this.clipsOf(scroller),
      scrolling: false,
      lingering: null,
      removing: null,
      drag: null,
    };
    this.owners.set(bars.vertical, bars);
    this.owners.set(bars.horizontal, bars);
    this.bars.set(scroller, bars);
    this.resize?.observe(scroller);
    if (scroller.firstElementChild !== null) {
      this.resize?.observe(scroller.firstElementChild);
    }
    return bars;
  }

  /**
   * Creates an element of the layer.
   * @param className The element's classes.
   * @param parent The element to add it to.
   * @returns Returns the element.
   */
  private element(className: string, parent: HTMLElement): HTMLElement {
    const element: HTMLElement = this.doc.createElement('div');
    element.className = className;
    parent.appendChild(element);
    return element;
  }

  /**
   * Finds the ancestors that clip an area: those whose overflow is anything but visible.
   * @param scroller The area.
   * @returns Returns the ancestors, nearest first.
   */
  private clipsOf(scroller: HTMLElement): HTMLElement[] {
    const clips: HTMLElement[] = [];
    let element: HTMLElement | null = scroller.parentElement;
    while (element !== null && element !== this.doc.body) {
      const style: CSSStyleDeclaration = this.view.getComputedStyle(element);
      if (style.overflowX !== 'visible' || style.overflowY !== 'visible') {
        clips.push(element);
      }
      element = element.parentElement;
    }
    return clips;
  }

  /**
   * Sizes and places an area's bars over the part of it that can be seen.
   * @param bars The bars.
   */
  private place(bars: Bars): void {
    const scroller: HTMLElement = bars.scroller;
    const area: Box = this.paddingBox(scroller);
    let visible: Box = {
      left: Math.max(area.left, 0),
      top: Math.max(area.top, 0),
      right: Math.min(area.right, this.view.innerWidth),
      bottom: Math.min(area.bottom, this.view.innerHeight),
    };
    for (const clip of bars.clips) {
      const box: Box = this.paddingBox(clip);
      visible = {
        left: Math.max(visible.left, box.left),
        top: Math.max(visible.top, box.top),
        right: Math.min(visible.right, box.right),
        bottom: Math.min(visible.bottom, box.bottom),
      };
    }
    if (visible.right <= visible.left || visible.bottom <= visible.top) {
      bars.frame.hidden = true;
      return;
    }
    bars.frame.hidden = false;
    this.setBox(bars.frame, visible, null);
    this.setBox(bars.box, area, visible);

    const showsY: boolean = this.overflows(bars, 'vertical');
    const showsX: boolean = this.overflows(bars, 'horizontal');
    this.placeThumb(bars, 'vertical', showsY);
    this.placeThumb(bars, 'horizontal', showsX);
  }

  /**
   * Sizes and places one thumb, or hides it when its axis has nowhere to scroll.
   * @param bars The bars.
   * @param axis The thumb's axis.
   * @param shows Whether the axis scrolls.
   */
  private placeThumb(bars: Bars, axis: Axis, shows: boolean): void {
    const thumb: HTMLElement = axis === 'vertical' ? bars.vertical : bars.horizontal;
    thumb.hidden = !shows;
    if (!shows) {
      return;
    }
    const scroller: HTMLElement = bars.scroller;
    const visible: number = axis === 'vertical' ? scroller.clientHeight : scroller.clientWidth;
    const content: number = axis === 'vertical' ? scroller.scrollHeight : scroller.scrollWidth;
    const position: number = axis === 'vertical' ? scroller.scrollTop : scroller.scrollLeft;
    const track: number = this.track(bars, axis);
    const length: number = Math.min(
      track,
      Math.max(MIN_THUMB_PX, Math.round((track * visible) / content)),
    );
    const travel: number = Math.max(0, track - length);
    const offset: number = INSET_PX + Math.round((position / (content - visible)) * travel);
    if (axis === 'vertical') {
      thumb.style.top = `${offset}px`;
      thumb.style.height = `${length}px`;
    } else {
      thumb.style.left = `${offset}px`;
      thumb.style.width = `${length}px`;
    }
  }

  /**
   * Gets the length of a thumb's track: the area's side, less the insets at its ends and the corner
   * where the bars would meet.
   * @param bars The bars.
   * @param axis The thumb's axis.
   * @returns Returns the length, in pixels.
   */
  private track(bars: Bars, axis: Axis): number {
    const scroller: HTMLElement = bars.scroller;
    const side: number = axis === 'vertical' ? scroller.clientHeight : scroller.clientWidth;
    const other: Axis = axis === 'vertical' ? 'horizontal' : 'vertical';
    return side - INSET_PX * 2 - (this.overflows(bars, other) ? CORNER_PX : 0);
  }

  /**
   * Gets whether an area scrolls along an axis.
   * @param bars The bars.
   * @param axis The axis.
   * @returns Returns true if it does.
   */
  private overflows(bars: Bars, axis: Axis): boolean {
    const scroller: HTMLElement = bars.scroller;
    const style: CSSStyleDeclaration = this.view.getComputedStyle(scroller);
    return axis === 'vertical'
      ? scroller.scrollHeight > scroller.clientHeight && SCROLLING_OVERFLOW.has(style.overflowY)
      : scroller.scrollWidth > scroller.clientWidth && SCROLLING_OVERFLOW.has(style.overflowX);
  }

  /**
   * Gets an element's padding box — inside its borders, where a scroll bar would be drawn.
   * @param element The element.
   * @returns Returns the box, in viewport coordinates.
   */
  private paddingBox(element: HTMLElement): Box {
    const rect: DOMRect = element.getBoundingClientRect();
    const left: number = rect.left + element.clientLeft;
    const top: number = rect.top + element.clientTop;
    return { left, top, right: left + element.clientWidth, bottom: top + element.clientHeight };
  }

  /**
   * Positions an element of the layer over a box.
   * @param element The element.
   * @param box The box, in viewport coordinates.
   * @param within The box the element is positioned in, or null for the viewport.
   */
  private setBox(element: HTMLElement, box: Box, within: Box | null): void {
    element.style.left = `${box.left - (within?.left ?? 0)}px`;
    element.style.top = `${box.top - (within?.top ?? 0)}px`;
    element.style.width = `${box.right - box.left}px`;
    element.style.height = `${box.bottom - box.top}px`;
  }

  /**
   * Keeps an area's bars that were about to be taken away.
   * @param bars The bars.
   */
  private cancelRemoval(bars: Bars): void {
    if (bars.removing !== null) {
      clearTimeout(bars.removing);
      bars.removing = null;
    }
  }

  /**
   * Takes an area's bars away.
   * @param bars The bars.
   */
  private remove(bars: Bars): void {
    this.cancelRemoval(bars);
    if (bars.lingering !== null) {
      clearTimeout(bars.lingering);
    }
    this.resize?.unobserve(bars.scroller);
    if (bars.scroller.firstElementChild !== null) {
      this.resize?.unobserve(bars.scroller.firstElementChild);
    }
    bars.frame.remove();
    this.bars.delete(bars.scroller);
  }
}
