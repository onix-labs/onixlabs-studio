import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

import { OverlayScrollbar } from './overlay-scrollbar';

/**
 * Hosts the directive over a scroll container nested inside it.
 */
@Component({
  imports: [OverlayScrollbar],
  template: `<nav class="rail" appOverlayScrollbar=".list">
    <div class="list"><div></div></div>
  </nav>`,
})
class Host {}

/**
 * Gives an element the layout jsdom does not compute.
 * @param element The element.
 * @param sizes The sizes to report.
 */
function layout(
  element: HTMLElement,
  sizes: { clientHeight: number; scrollHeight: number; offsetTop?: number },
): void {
  Object.defineProperty(element, 'clientHeight', { configurable: true, value: sizes.clientHeight });
  Object.defineProperty(element, 'scrollHeight', { configurable: true, value: sizes.scrollHeight });
  Object.defineProperty(element, 'offsetTop', { configurable: true, value: sizes.offsetTop ?? 0 });
}

describe('OverlayScrollbar', () => {
  let fixture: ComponentFixture<Host>;
  let rail: HTMLElement;
  let list: HTMLElement;
  let directive: OverlayScrollbar;

  beforeEach(() => {
    fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    rail = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.rail')!;
    list = rail.querySelector<HTMLElement>('.list')!;
    directive = fixture.debugElement.children[0].injector.get(OverlayScrollbar);
  });

  /**
   * Gets the thumb.
   * @returns Returns it.
   */
  function thumb(): HTMLElement {
    return rail.querySelector<HTMLElement>('.overlay-scrollbar__thumb')!;
  }

  it('hidesTheNativeBar_ofTheScrollerItNames', () => {
    expect(rail.classList).toContain('overlay-scrollbar');
    expect(list.classList).toContain('overlay-scrollbar__scroller');
  });

  it('drawsNoThumb_whenNothingOverflows', () => {
    layout(list, { clientHeight: 200, scrollHeight: 200 });

    directive.refresh();

    expect(thumb().hidden).toBe(true);
  });

  it('sizesAndPlacesTheThumb_fromWhatIsVisibleAndHowFarItIsScrolled', () => {
    layout(list, { clientHeight: 206, scrollHeight: 412, offsetTop: 8 });

    directive.refresh();
    expect(thumb().hidden).toBe(false);
    expect(thumb().style.height).toBe('100px');
    expect(thumb().style.top).toBe('11px');

    list.scrollTop = 206;
    directive.refresh();
    expect(thumb().style.top).toBe('111px');
  });

  it('keepsALongListsThumbLongEnoughToGrab', () => {
    layout(list, { clientHeight: 100, scrollHeight: 100_000 });

    directive.refresh();

    expect(thumb().style.height).toBe('24px');
  });

  it('showsTheThumb_whileThePointerIsOver_orWhileScrolling', () => {
    vi.useFakeTimers();
    try {
      layout(list, { clientHeight: 100, scrollHeight: 300 });
      directive.refresh();
      expect(thumb().classList).not.toContain('overlay-scrollbar__thumb--shown');

      rail.dispatchEvent(new Event('pointerenter'));
      expect(thumb().classList).toContain('overlay-scrollbar__thumb--shown');
      rail.dispatchEvent(new Event('pointerleave'));
      expect(thumb().classList).not.toContain('overlay-scrollbar__thumb--shown');

      list.dispatchEvent(new Event('scroll'));
      expect(thumb().classList).toContain('overlay-scrollbar__thumb--shown');
      vi.advanceTimersByTime(1000);
      expect(thumb().classList).not.toContain('overlay-scrollbar__thumb--shown');
    } finally {
      vi.useRealTimers();
    }
  });

  it('scrollsByAsMuchAsTheThumbIsDragged', () => {
    layout(list, { clientHeight: 206, scrollHeight: 412 });
    directive.refresh();
    Object.defineProperty(thumb(), 'offsetHeight', { configurable: true, value: 100 });

    thumb().dispatchEvent(
      Object.assign(new MouseEvent('pointerdown', { button: 0, clientY: 50 }), { pointerId: 1 }),
    );
    thumb().dispatchEvent(
      Object.assign(new MouseEvent('pointermove', { clientY: 100 }), { pointerId: 1 }),
    );
    thumb().dispatchEvent(
      Object.assign(new MouseEvent('pointerup', { clientY: 100 }), { pointerId: 1 }),
    );

    // 50px of a 100px travel is half of the 206px there is to scroll.
    expect(list.scrollTop).toBe(103);
  });

  it('takesTheThumbAway_whenDestroyed', () => {
    fixture.destroy();

    expect(rail.querySelector('.overlay-scrollbar__thumb')).toBeNull();
  });
});
