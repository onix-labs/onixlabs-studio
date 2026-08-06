import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScrollReveal } from './scroll-reveal';

/**
 * The stylesheet keys the scroll reveal off this attribute (mirrors `data-app-scrolling` in the
 * service).
 */
const SCROLLING_ATTR: string = 'data-app-scrolling';

describe('ScrollReveal', () => {
  let element: HTMLElement;

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({});
    TestBed.inject(ScrollReveal);
    element = document.createElement('div');
    document.body.appendChild(element);
  });

  afterEach(() => {
    element.remove();
    vi.useRealTimers();
  });

  /**
   * Dispatches a scroll event whose target is the given element, reaching the document capture
   * listener the service installs.
   * @param target The element to scroll.
   */
  function scroll(target: HTMLElement): void {
    target.dispatchEvent(new Event('scroll', { bubbles: false }));
  }

  it('scroll_marksTheElement_thenClearsItAfterTheIdleWindow', () => {
    scroll(element);
    expect(element.hasAttribute(SCROLLING_ATTR)).toBe(true);

    vi.advanceTimersByTime(800);

    expect(element.hasAttribute(SCROLLING_ATTR)).toBe(false);
  });

  it('continuedScrolling_keepsTheElementMarked_pastASingleIdleWindow', () => {
    scroll(element);
    vi.advanceTimersByTime(600);
    scroll(element); // resets the fade timer
    vi.advanceTimersByTime(600);

    // 1200ms since the first scroll, but only 600ms since the last — still revealed.
    expect(element.hasAttribute(SCROLLING_ATTR)).toBe(true);

    vi.advanceTimersByTime(200);
    expect(element.hasAttribute(SCROLLING_ATTR)).toBe(false);
  });
});
