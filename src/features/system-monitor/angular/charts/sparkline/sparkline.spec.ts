import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { Sparkline } from './sparkline';

/**
 * Renders a sparkline.
 * @param values The readings.
 * @param max The scale's top.
 * @param capacity How many readings span the width.
 * @returns Returns the fixture.
 */
function render(
  values: readonly number[],
  max: number,
  capacity: number = 5,
): ComponentFixture<Sparkline> {
  const fixture: ComponentFixture<Sparkline> = TestBed.createComponent(Sparkline);
  fixture.componentRef.setInput('values', values);
  fixture.componentRef.setInput('max', max);
  fixture.componentRef.setInput('capacity', capacity);
  fixture.detectChanges();
  return fixture;
}

/**
 * Reads the drawn line's path.
 * @param fixture The fixture.
 * @returns Returns the path, or null when none is drawn.
 */
function lineOf(fixture: ComponentFixture<Sparkline>): string | null {
  const element: HTMLElement = fixture.nativeElement as HTMLElement;
  return element.querySelector('.sparkline__line')?.getAttribute('d') ?? null;
}

describe('Sparkline', () => {
  it('drawsNothing_untilThereAreTwoReadings', () => {
    expect(lineOf(render([5], 10))).toBeNull();
  });

  it('putsTheNewestReadingAtTheRightEdge_andAShortSeriesPartWayAcross', () => {
    // Capacity 5 spans 100 in four steps of 25; two readings start at 75. 0 sits on the floor (22) and
    // the top of the scale at the ceiling (2).
    expect(lineOf(render([0, 10], 10))).toBe('M75.00,22.00L100.00,2.00');
  });

  it('holdsReadingsToTheScale', () => {
    expect(lineOf(render([-5, 50], 10))).toBe('M75.00,22.00L100.00,2.00');
  });
});
