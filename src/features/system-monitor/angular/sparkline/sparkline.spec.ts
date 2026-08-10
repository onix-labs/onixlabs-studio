import { Signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { Sparkline } from './sparkline';

/**
 * Exposes the sparkline's computed paths for assertion.
 */
interface Testable {
  linePath: Signal<string>;
  areaPath: Signal<string>;
}

describe('Sparkline', () => {
  let fixture: ComponentFixture<Sparkline>;

  /**
   * Creates a sparkline with the given series and max.
   * @param values The series to plot.
   * @param max The value mapping to full height.
   * @returns Returns the component's testable surface.
   */
  function create(values: readonly number[], max: number = 100): Testable {
    fixture = TestBed.createComponent(Sparkline);
    fixture.componentRef.setInput('values', values);
    fixture.componentRef.setInput('max', max);
    fixture.detectChanges();
    return fixture.componentInstance as unknown as Testable;
  }

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('withNoValues_producesEmptyPaths', () => {
    const view: Testable = create([]);
    expect(view.linePath()).toBe('');
    expect(view.areaPath()).toBe('');
  });

  it('withOneValue_drawsAFlatLineAtItsHeight', () => {
    const view: Testable = create([50]);
    expect(view.linePath()).toBe('M 0 50 L 100 50');
  });

  it('withManyValues_plotsLeftToRightScaledToMax', () => {
    const view: Testable = create([0, 100]);
    expect(view.linePath()).toBe('M 0 100 L 100 0');
  });

  it('clampsValuesAboveMax', () => {
    const view: Testable = create([200], 100);
    // 200 clamps to 100 → full height → y = 0.
    expect(view.linePath()).toBe('M 0 0 L 100 0');
  });

  it('areaPath_closesTheLineToTheBaseline', () => {
    const view: Testable = create([0, 100]);
    expect(view.areaPath()).toBe('M 0 100 L 100 0 L 100 100 L 0 100 Z');
  });
});
