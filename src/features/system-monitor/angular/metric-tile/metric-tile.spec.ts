import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { MetricTile, TileChannel } from './metric-tile';

describe('MetricTile', () => {
  let fixture: ComponentFixture<MetricTile>;

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  /**
   * Creates a tile with the given label, optional suffix and channels, and renders it.
   * @param label The tile label.
   * @param channels The channels to graph.
   * @param suffix The optional label suffix.
   * @returns Returns the rendered host element.
   */
  function create(label: string, channels: readonly TileChannel[], suffix: string | null = null): HTMLElement {
    fixture = TestBed.createComponent(MetricTile);
    fixture.componentRef.setInput('label', label);
    fixture.componentRef.setInput('suffix', suffix);
    fixture.componentRef.setInput('channels', channels);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('rendersTheLabelAndSingleChannelValue', () => {
    const element: HTMLElement = create('CPU', [{ value: '37%', values: [10, 20, 37] }]);
    expect(element.querySelector('.metric-tile__label')?.textContent).toContain('CPU');
    expect(element.querySelector('.metric-tile__value')?.textContent).toContain('37%');
  });

  it('rendersTheLabelSuffix', () => {
    const element: HTMLElement = create('Memory', [{ value: '8.0 GB (50%)', values: [50] }], '16.0 GB');
    expect(element.querySelector('.metric-tile__suffix')?.textContent).toContain('16.0 GB');
  });

  it('splitsIntoSysAndAppWhenTheChannelHasAnAppValue', () => {
    const element: HTMLElement = create('CPU', [
      { value: '42%', values: [42], appValue: '12%', appValues: [12] },
    ]);
    const text: string = element.querySelector('.metric-tile__head')?.textContent ?? '';
    expect(text).toContain('SYS');
    expect(text).toContain('42%');
    expect(text).toContain('APP');
    expect(text).toContain('12%');
  });

  it('rendersOneCaptionedSparklinePerChannelForAMultiChannelTile', () => {
    const element: HTMLElement = create('Network', [
      { caption: 'Received', value: '1.0 KB/s', values: [1024], max: 2048 },
      { caption: 'Sent', value: '512 B/s', values: [512], max: 1024 },
    ]);
    const captions: string[] = Array.from(element.querySelectorAll('.metric-tile__series')).map(
      (node: Element): string => node.textContent?.trim() ?? '',
    );
    expect(captions).toEqual(['Received', 'Sent']);
    expect(element.querySelectorAll('app-sparkline')).toHaveLength(2);
  });
});
