import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SystemMonitorReadings } from '../../../../readings/system-monitor-readings';
import { MemoryCard } from './memory-card';

describe('MemoryCard', () => {
  let fixture: ComponentFixture<MemoryCard>;
  let host: HTMLElement;
  let readings: SystemMonitorReadings;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MemoryCard],
      providers: [SystemMonitorReadings],
    }).compileComponents();
    readings = TestBed.inject(SystemMonitorReadings);
    fixture = TestBed.createComponent(MemoryCard);
    host = fixture.nativeElement as HTMLElement;
  });

  afterEach(() => {
    globalThis.localStorage?.clear();
  });

  it('metersMemoryInUse_besideWhatIsAvailableAndTheTotal', async () => {
    readings.accept({
      timestamp: 't',
      cpu: 0,
      memory: { usedBytes: 49 * 1024 ** 3, totalBytes: 256 * 1024 ** 3, percent: 19 },
      memoryDetail: { availableBytes: 217 * 1024 ** 3, swapUsedBytes: 0, swapTotalBytes: 0 },
      app: { cpuPercent: 0, memoryBytes: 512 * 1024 ** 2, memoryPercent: 0.2 },
    });
    fixture.detectChanges();
    await fixture.whenStable();

    expect(host.querySelector('[role="meter"]')?.getAttribute('aria-valuenow')).toBe('19');
    expect(host.textContent).toContain('49.0 GB');
    expect(host.textContent).toContain('217.0 GB');
    expect(host.textContent).toContain('256.0 GB');
    expect(host.textContent).toContain('512.0 MB (0%)');
    expect(host.querySelector('[aria-label="Legend"]')?.textContent).toContain('Studio');
  });
});
