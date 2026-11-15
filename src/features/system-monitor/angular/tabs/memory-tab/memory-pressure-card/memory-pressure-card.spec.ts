import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SystemMonitorProcesses } from '../../../readings/system-monitor-processes';
import { SystemMonitorReadings } from '../../../readings/system-monitor-readings';
import { MEMORY_SAMPLE } from '../memory-test-sample';
import { MemoryPressureCard } from './memory-pressure-card';

describe('MemoryPressureCard', () => {
  let fixture: ComponentFixture<MemoryPressureCard>;
  let host: HTMLElement;
  let readings: SystemMonitorReadings;
  let listing: SystemMonitorProcesses;

  /**
   * Settles the fixture after a change.
   */
  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MemoryPressureCard],
      providers: [SystemMonitorReadings, SystemMonitorProcesses],
    }).compileComponents();
    readings = TestBed.inject(SystemMonitorReadings);
    listing = TestBed.inject(SystemMonitorProcesses);
    fixture = TestBed.createComponent(MemoryPressureCard);
    host = fixture.nativeElement as HTMLElement;
  });

  afterEach(() => {
    globalThis.localStorage?.clear();
  });

  it('statesTheLevel_inWordsAndAnIcon_withABar', async () => {
    readings.accept(MEMORY_SAMPLE);
    await settle();

    expect(host.textContent).toContain('Normal');
    expect(host.textContent).toContain('plenty of memory available');
    expect(host.querySelector('[role="meter"]')?.getAttribute('aria-valuenow')).toBe('4');
  });

  it('saysSo_whereThePlatformReportsNoPressure', async () => {
    readings.accept({
      ...MEMORY_SAMPLE,
      memoryDetail: { availableBytes: 1, swapUsedBytes: 0, swapTotalBytes: 0 },
    });
    await settle();

    expect(host.textContent).toContain('does not report memory pressure');
    expect(listing).toBeDefined();
  });
});
