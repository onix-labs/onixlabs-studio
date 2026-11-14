import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { ChartSeries } from '../chart-series';
import { LineChart } from './line-chart';

describe('LineChart', () => {
  let fixture: ComponentFixture<LineChart>;
  let host: HTMLElement;

  /**
   * Draws the chart with the given inputs.
   * @param series The series.
   * @param inputs Any other inputs.
   */
  async function draw(
    series: readonly ChartSeries[],
    inputs: Record<string, unknown> = {},
  ): Promise<void> {
    fixture.componentRef.setInput('series', series);
    fixture.componentRef.setInput('ariaLabel', 'Test chart');
    for (const [name, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(name, value);
    }
    fixture.detectChanges();
    await fixture.whenStable();
  }

  /**
   * Gets the plot, which carries the chart's name and takes the keyboard.
   * @returns Returns the plot.
   */
  function plot(): HTMLElement {
    const element: HTMLElement | null = host.querySelector('[role="img"]');
    if (element === null) {
      throw new Error('No plot');
    }
    return element;
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [LineChart] }).compileComponents();
    fixture = TestBed.createComponent(LineChart);
    host = fixture.nativeElement as HTMLElement;
  });

  it('labelsAFixedAxis_inCleanQuarters', async () => {
    await draw([{ label: 'CPU', values: [10, 20], emphasis: 'primary' }], {
      max: 100,
      format: (value: number): string => `${value}%`,
    });

    const ticks: string[] = Array.from(host.querySelectorAll('.line-chart__tick')).map(
      (tick: Element): string => tick.textContent?.trim() ?? '',
    );
    expect(ticks).toEqual(['100%', '75%', '50%', '25%', '0%']);
    expect(plot().getAttribute('aria-label')).toBe('Test chart');
  });

  it('scalesToThePeak_whenNoMaximumIsGiven', async () => {
    await draw([{ label: 'Rate', values: [3, 73], emphasis: 'primary' }]);

    expect(host.querySelector('.line-chart__tick')?.textContent?.trim()).toBe('80');
  });

  it('namesTwoSeriesInALegend_butNotOne', async () => {
    await draw([{ label: 'CPU', values: [1], emphasis: 'primary' }]);
    expect(host.querySelector('[aria-label="Legend"]')).toBeNull();

    await draw([
      { label: 'Received', values: [1], emphasis: 'primary' },
      { label: 'Sent', values: [2], emphasis: 'secondary' },
    ]);
    expect(host.querySelector('[aria-label="Legend"]')?.textContent).toContain('Received');
    expect(host.querySelector('[aria-label="Legend"]')?.textContent).toContain('Sent');
  });

  it('leavesTheLegendOut_whenTheHostNamesTheSeries', async () => {
    await draw(
      [
        { label: 'System', values: [1], emphasis: 'primary' },
        { label: 'Studio', values: [2], emphasis: 'secondary' },
      ],
      { showLegend: false },
    );

    expect(host.querySelector('[aria-label="Legend"]')).toBeNull();
  });

  it('readsEverySeriesAtTheCrosshair_fromTheKeyboard', async () => {
    await draw(
      [
        { label: 'Received', values: [10, 20, 30], emphasis: 'primary' },
        { label: 'Sent', values: [1, 2, 3], emphasis: 'secondary' },
      ],
      { intervalMs: 2000 },
    );

    plot().dispatchEvent(new FocusEvent('focus'));
    fixture.detectChanges();
    expect(host.querySelector('[role="status"]')?.textContent).toContain('Now');
    expect(host.querySelector('[role="status"]')?.textContent).toContain('30');

    plot().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    fixture.detectChanges();
    const readout: string = host.querySelector('[role="status"]')?.textContent ?? '';
    expect(readout).toContain('2 s ago');
    expect(readout).toContain('20');
    expect(readout).toContain('2');

    plot().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    expect(host.querySelector('[role="status"]')).toBeNull();
  });
});
