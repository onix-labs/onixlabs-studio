import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { MetricTile } from './metric-tile';

describe('MetricTile', () => {
  let fixture: ComponentFixture<MetricTile>;

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  /**
   * Creates a tile with the given inputs and renders it.
   * @returns Returns the rendered host element.
   */
  function create(): HTMLElement {
    fixture = TestBed.createComponent(MetricTile);
    fixture.componentRef.setInput('label', 'CPU');
    fixture.componentRef.setInput('value', '37%');
    fixture.componentRef.setInput('values', [10, 20, 37]);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('rendersTheLabelAndValue', () => {
    const element: HTMLElement = create();
    expect(element.querySelector('.metric-tile__label')?.textContent).toContain('CPU');
    expect(element.querySelector('.metric-tile__value')?.textContent).toContain('37%');
  });

  it('rendersASparklineForTheSeries', () => {
    const element: HTMLElement = create();
    expect(element.querySelector('app-sparkline')).not.toBeNull();
    expect(element.querySelector('path.sparkline__line')).not.toBeNull();
  });
});
