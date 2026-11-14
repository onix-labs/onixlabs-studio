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

  it('graphsReceivedAndSent_namedByTheBadges_andListsTheThreeBusiestInterfaces', async () => {
    readings.accept({
      timestamp: 't',
      cpu: 0,
      memory: { usedBytes: 1, totalBytes: 2, percent: 50 },
      network: { rxBytesPerSec: 4096, txBytesPerSec: 1024 },
      interfaces: ['en2', 'en7', 'lo0', 'utun0'].map((name: string) => ({
        name,
        rxBytesPerSec: 1,
        txBytesPerSec: 1,
      })),
    });
    fixture.detectChanges();
    await fixture.whenStable();

    // The badges name the lines in their colours, so the graph carries no legend.
    expect(host.querySelector('[aria-label="Legend"]')).toBeNull();
    expect(host.textContent).toContain('Sent');
    expect(host.textContent).toContain('4.0 KB/s');
    const rows: NodeListOf<HTMLTableRowElement> = host.querySelectorAll(
      '[data-testid="network-card-interfaces"] tbody tr',
    );
    expect(
      Array.from(rows).map(
        (row: HTMLTableRowElement): string => row.cells[0].textContent?.trim() ?? '',
      ),
    ).toEqual(['en2', 'en7', 'lo0']);
  });
});
