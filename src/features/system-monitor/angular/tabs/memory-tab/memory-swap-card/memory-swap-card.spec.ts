import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SystemMonitorProcesses } from '../../../readings/system-monitor-processes';
import { SystemMonitorReadings } from '../../../readings/system-monitor-readings';
import { MEMORY_SAMPLE } from '../memory-test-sample';
import { MemorySwapCard } from './memory-swap-card';

describe('MemorySwapCard', () => {
  let fixture: ComponentFixture<MemorySwapCard>;
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
      imports: [MemorySwapCard],
      providers: [SystemMonitorReadings, SystemMonitorProcesses],
    }).compileComponents();
    readings = TestBed.inject(SystemMonitorReadings);
    listing = TestBed.inject(SystemMonitorProcesses);
    fixture = TestBed.createComponent(MemorySwapCard);
    host = fixture.nativeElement as HTMLElement;
  });

  afterEach(() => {
    globalThis.localStorage?.clear();
  });

  it('saysSwapIsInactive_whenNoneOfItIsInUse', async () => {
    readings.accept({
      ...MEMORY_SAMPLE,
      memoryDetail: { availableBytes: 1, swapUsedBytes: 0, swapTotalBytes: 2 * 1024 ** 3 },
    });
    await settle();

    expect(host.textContent).toContain('Swap is inactive');
    expect(host.querySelector('[role="meter"]')?.getAttribute('aria-valuenow')).toBe('0');
  });

  it('saysNoneIsSetAside_whereNoSwapIsConfigured', async () => {
    readings.accept(MEMORY_SAMPLE);
    await settle();

    expect(host.textContent).toContain('none is set aside');
    expect(host.querySelector('[role="meter"]')).toBeNull();
    expect(listing).toBeDefined();
  });
});
