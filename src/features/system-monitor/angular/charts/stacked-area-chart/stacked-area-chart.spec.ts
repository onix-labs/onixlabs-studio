import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { StackedAreaChart } from './stacked-area-chart';

describe('StackedAreaChart', () => {
  let fixture: ComponentFixture<StackedAreaChart>;
  let host: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [StackedAreaChart] }).compileComponents();
    fixture = TestBed.createComponent(StackedAreaChart);
    host = fixture.nativeElement as HTMLElement;
    fixture.componentRef.setInput('layers', [
      { label: 'Apps', values: [10, 20], color: 'red' },
      { label: 'Cached', values: [5, 5], color: 'blue' },
    ]);
    fixture.componentRef.setInput('max', 100);
    fixture.componentRef.setInput('format', (value: number): string => `${value} GB`);
    fixture.componentRef.setInput('ariaLabel', 'Composition');
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('labelsTheAxisToTheWhole_inQuarters', () => {
    const ticks: string[] = Array.from(host.querySelectorAll('.stacked-area-chart__tick')).map(
      (tick: Element): string => tick.textContent?.trim() ?? '',
    );
    expect(ticks).toEqual(['100 GB', '75 GB', '50 GB', '25 GB', '0 GB']);
  });

  it('stacksEachLayerOnTheLast', () => {
    const bands: string[] = Array.from(host.querySelectorAll('path')).map(
      (path: Element): string => path.getAttribute('d') ?? '',
    );
    // Apps runs from 90 to 80 (10 then 20 of 100); Cached sits on it, from 85 to 75.
    expect(bands[0]).toBe('M0,90L100,80L100,100L0,100Z');
    expect(bands[1]).toBe('M0,85L100,75L100,80L0,90Z');
  });

  it('readsEveryLayer_topFirst_fromTheKeyboard', () => {
    const plot: HTMLElement | null = host.querySelector('[role="img"]');
    plot?.dispatchEvent(new FocusEvent('focus'));
    fixture.detectChanges();

    const rows: string[] = Array.from(
      host.querySelectorAll('[role="status"] .stacked-area-chart__row'),
    ).map(
      (row: Element): string =>
        `${row.querySelector('strong')?.textContent?.trim()} ${row.querySelector('strong + span')?.textContent?.trim()}`,
    );
    expect(rows).toEqual(['5 GB Cached', '20 GB Apps']);
  });
});
