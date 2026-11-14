import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SystemMonitorReadings } from '../../readings/system-monitor-readings';
import { NetworkTab } from './network-tab';

describe('NetworkTab', () => {
  let fixture: ComponentFixture<NetworkTab>;
  let host: HTMLElement;
  let readings: SystemMonitorReadings;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NetworkTab],
      providers: [SystemMonitorReadings],
    }).compileComponents();
    readings = TestBed.inject(SystemMonitorReadings);
    fixture = TestBed.createComponent(NetworkTab);
    host = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  afterEach(() => {
    globalThis.localStorage?.clear();
  });

  it('listsEachInterface_withItsThroughput', async () => {
    expect(host.querySelector('[data-testid="network-interfaces"]')).toBeNull();

    readings.accept({
      timestamp: 't',
      cpu: 0,
      memory: { usedBytes: 1, totalBytes: 2, percent: 50 },
      interfaces: [
        { name: 'en0', rxBytesPerSec: 2048, txBytesPerSec: 512 },
        { name: 'lo0', rxBytesPerSec: 0, txBytesPerSec: 0 },
      ],
    });
    fixture.detectChanges();
    await fixture.whenStable();

    const rows: NodeListOf<HTMLTableRowElement> = host.querySelectorAll(
      '[data-testid="network-interfaces"] tbody tr',
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('en0');
    expect(rows[0].textContent).toContain('2.0 KB/s');
    expect(rows[0].textContent).toContain('512 B/s');
  });
});
