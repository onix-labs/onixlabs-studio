import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SystemMonitorReadings } from '../../../../readings/system-monitor-readings';
import { NetworkCard } from './network-card';

describe('NetworkCard', () => {
  let fixture: ComponentFixture<NetworkCard>;
  let host: HTMLElement;
  let readings: SystemMonitorReadings;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NetworkCard],
      providers: [SystemMonitorReadings],
    }).compileComponents();
    readings = TestBed.inject(SystemMonitorReadings);
    fixture = TestBed.createComponent(NetworkCard);
    host = fixture.nativeElement as HTMLElement;
  });

  afterEach(() => {
    globalThis.localStorage?.clear();
  });

  it('graphsReceivedAndSentApart_namedByTheBadges', async () => {
    readings.accept({
      timestamp: 't',
      cpu: 0,
      memory: { usedBytes: 1, totalBytes: 2, percent: 50 },
      network: { rxBytesPerSec: 4096, txBytesPerSec: 1024 },
    });
    fixture.detectChanges();
    await fixture.whenStable();

    // A graph each, received then sent; the badges name them in their colours, so neither has a legend.
    const graphs: string[] = Array.from(host.querySelectorAll('app-system-monitor-line-chart')).map(
      (chart: Element): string => chart.getAttribute('ariaLabel') ?? '',
    );
    expect(graphs).toEqual(['Network data received over time', 'Network data sent over time']);
    expect(host.querySelector('[aria-label="Legend"]')).toBeNull();
    expect(host.textContent).toContain('4.0 KB/s');
    // The interfaces are the Network view's.
    expect(host.querySelector('table')).toBeNull();
  });
});
