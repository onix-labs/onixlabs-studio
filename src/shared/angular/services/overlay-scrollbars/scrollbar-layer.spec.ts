import { vi } from 'vitest';

import { ScrollbarLayer } from './scrollbar-layer';

/**
 * The layout jsdom does not compute, given to an element.
 */
interface Layout {
  readonly left?: number;
  readonly top?: number;
  readonly clientWidth: number;
  readonly clientHeight: number;
  readonly scrollWidth?: number;
  readonly scrollHeight?: number;
}

/**
 * Gives an element the layout jsdom does not compute.
 * @param element The element.
 * @param layout The layout to report.
 */
function lay(element: HTMLElement, layout: Layout): void {
  const left: number = layout.left ?? 0;
  const top: number = layout.top ?? 0;
  const sizes: Record<string, number> = {
    clientWidth: layout.clientWidth,
    clientHeight: layout.clientHeight,
    scrollWidth: layout.scrollWidth ?? layout.clientWidth,
    scrollHeight: layout.scrollHeight ?? layout.clientHeight,
    clientLeft: 0,
    clientTop: 0,
  };
  for (const [name, value] of Object.entries(sizes)) {
    Object.defineProperty(element, name, { configurable: true, value });
  }
  element.getBoundingClientRect = (): DOMRect =>
    new DOMRect(left, top, layout.clientWidth, layout.clientHeight);
}

/**
 * Creates a pointer event jsdom can dispatch.
 * @param type The event type.
 * @param init The event's coordinates, button and pointer.
 * @returns Returns the event.
 */
function pointer(
  type: string,
  init: { clientX?: number; clientY?: number; button?: number; relatedTarget?: null } = {},
): MouseEvent {
  return Object.assign(new MouseEvent(type, { bubbles: true, ...init }), { pointerId: 1 });
}

describe('ScrollbarLayer', () => {
  let layer: ScrollbarLayer;
  let scroller: HTMLElement;
  let row: HTMLElement;

  beforeEach(() => {
    scroller = document.createElement('div');
    scroller.style.overflowY = 'auto';
    row = document.createElement('div');
    scroller.appendChild(row);
    document.body.appendChild(scroller);
    lay(scroller, { left: 10, top: 20, clientWidth: 100, clientHeight: 206, scrollHeight: 412 });
    layer = new ScrollbarLayer(document);
  });

  afterEach(() => {
    layer.dispose();
    scroller.remove();
    vi.useRealTimers();
  });

  /**
   * Gets the frame drawn over the area, if any.
   * @returns Returns it, or null.
   */
  function frame(): HTMLElement | null {
    return document.querySelector<HTMLElement>('.app-scrollbars__frame');
  }

  /**
   * Gets a thumb drawn over the area.
   * @param axis The thumb's axis.
   * @returns Returns it.
   */
  function thumb(axis: 'vertical' | 'horizontal'): HTMLElement {
    return document.querySelector<HTMLElement>(`.app-scrollbars__thumb--${axis}`)!;
  }

  /**
   * Moves the pointer over an element and redraws.
   * @param target The element.
   */
  function hover(target: Element): void {
    target.dispatchEvent(pointer('pointermove'));
    layer.update();
  }

  it('drawsNothing_untilAnAreaIsHoveredOrScrolled', () => {
    expect(document.querySelector('.app-scrollbars')).not.toBeNull();
    expect(frame()).toBeNull();
  });

  it('showsTheBar_whileThePointerIsOverAnything_inAnAreaThatOverflows', () => {
    hover(row);

    expect(frame()!.classList).toContain('app-scrollbars__frame--shown');
    expect(thumb('vertical').hidden).toBe(false);
    expect(thumb('horizontal').hidden).toBe(true);
  });

  it('drawsOverTheAreasPaddingBox', () => {
    hover(row);

    expect(frame()!.style.left).toBe('10px');
    expect(frame()!.style.top).toBe('20px');
    expect(frame()!.style.width).toBe('100px');
    expect(frame()!.style.height).toBe('206px');
  });

  it('sizesAndPlacesTheThumb_fromWhatIsVisibleAndHowFarItIsScrolled', () => {
    hover(row);
    // A 200px track (206 less 3px at each end) showing half the content.
    expect(thumb('vertical').style.height).toBe('100px');
    expect(thumb('vertical').style.top).toBe('3px');

    scroller.scrollTop = 206;
    layer.update();

    expect(thumb('vertical').style.top).toBe('103px');
  });

  it('keepsALongListsThumbLongEnoughToGrab', () => {
    lay(scroller, { clientWidth: 100, clientHeight: 100, scrollHeight: 100_000 });

    hover(row);

    expect(thumb('vertical').style.height).toBe('24px');
  });

  it('drawsAThumbAcross_forAnAreaThatScrollsSideways', () => {
    scroller.style.overflowX = 'auto';
    lay(scroller, { clientWidth: 206, clientHeight: 100, scrollWidth: 412 });

    hover(row);

    expect(thumb('vertical').hidden).toBe(true);
    expect(thumb('horizontal').hidden).toBe(false);
    expect(thumb('horizontal').style.width).toBe('100px');
    expect(thumb('horizontal').style.left).toBe('3px');
  });

  it('leavesRoomInTheCorner_whereBothBarsShow', () => {
    scroller.style.overflowX = 'auto';
    lay(scroller, { clientWidth: 206, clientHeight: 206, scrollWidth: 412, scrollHeight: 412 });

    hover(row);

    // Each track gives up 8px to the corner: (206 - 6 - 8) / 2.
    expect(thumb('vertical').style.height).toBe('96px');
    expect(thumb('horizontal').style.width).toBe('96px');
  });

  it('drawsNothing_overAnAreaWithNowhereToScroll', () => {
    lay(scroller, { clientWidth: 100, clientHeight: 206 });

    hover(row);

    expect(frame()).toBeNull();
  });

  it('drawsNothing_overAnElementThatClipsRatherThanScrolls', () => {
    scroller.style.overflowY = 'hidden';

    hover(row);

    expect(frame()).toBeNull();
  });

  it('drawsNothing_overAnAreaThatAsksForNoBar', () => {
    scroller.style.setProperty('--app-scrollbar', 'none');

    hover(row);

    expect(frame()).toBeNull();
  });

  it('clipsTheBar_toWhatAnEnclosingElementShows', () => {
    const clip: HTMLElement = document.createElement('div');
    clip.style.overflowX = 'hidden';
    clip.style.overflowY = 'hidden';
    document.body.appendChild(clip);
    clip.appendChild(scroller);
    lay(clip, { left: 0, top: 0, clientWidth: 60, clientHeight: 120 });

    hover(row);

    // The area starts at (10, 20); the clip ends at (60, 120).
    expect(frame()!.style.width).toBe('50px');
    expect(frame()!.style.height).toBe('100px');
    clip.remove();
  });

  it('hidesTheBar_whenThePointerLeavesTheArea', () => {
    hover(row);

    hover(document.body);

    expect(frame()!.classList).not.toContain('app-scrollbars__frame--shown');
  });

  it('hidesTheBar_whenThePointerLeavesTheWindow', () => {
    hover(row);

    row.dispatchEvent(pointer('pointerout', { relatedTarget: null }));
    layer.update();

    expect(frame()!.classList).not.toContain('app-scrollbars__frame--shown');
  });

  it('keepsTheBarShown_whileThePointerIsOverTheThumb', () => {
    hover(row);

    hover(thumb('vertical'));

    expect(frame()!.classList).toContain('app-scrollbars__frame--shown');
  });

  it('showsTheBar_whileTheAreaScrolls_andTakesItAwayAfter', () => {
    vi.useFakeTimers();

    scroller.dispatchEvent(new Event('scroll'));
    layer.update();
    expect(frame()!.classList).toContain('app-scrollbars__frame--shown');

    vi.advanceTimersByTime(1000);
    layer.update();
    expect(frame()!.classList).not.toContain('app-scrollbars__frame--shown');

    vi.advanceTimersByTime(1000);
    expect(frame()).toBeNull();
  });

  it('scrollsByAsMuchAsTheThumbIsDragged', () => {
    hover(row);
    Object.defineProperty(thumb('vertical'), 'offsetHeight', { configurable: true, value: 100 });

    thumb('vertical').dispatchEvent(pointer('pointerdown', { button: 0, clientY: 50 }));
    thumb('vertical').dispatchEvent(pointer('pointermove', { clientY: 100 }));
    thumb('vertical').dispatchEvent(pointer('pointerup', { clientY: 100 }));

    // 50px of a 100px travel is half of the 206px there is to scroll.
    expect(scroller.scrollTop).toBe(103);
  });

  it('scrollsTheArea_whenTheWheelTurnsOverItsThumb', () => {
    hover(row);
    const scrollBy: ReturnType<typeof vi.fn> = vi.fn();
    scroller.scrollBy = scrollBy as unknown as HTMLElement['scrollBy'];

    thumb('vertical').dispatchEvent(
      new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 40 }),
    );

    expect(scrollBy).toHaveBeenCalledWith({ left: 0, top: 40 });
  });

  it('takesTheBarAway_whenTheAreaLeavesTheDocument', () => {
    hover(row);

    scroller.remove();
    layer.update();

    expect(frame()).toBeNull();
  });

  it('takesTheLayerAway_whenDisposed', () => {
    hover(row);

    layer.dispose();

    expect(document.querySelector('.app-scrollbars')).toBeNull();
  });
});
