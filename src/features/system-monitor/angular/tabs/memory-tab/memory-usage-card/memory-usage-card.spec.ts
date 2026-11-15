import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SystemMonitorProcesses } from '../../../readings/system-monitor-processes';
import { SystemMonitorReadings } from '../../../readings/system-monitor-readings';
import { MEMORY_SAMPLE } from '../memory-test-sample';
import { MemoryUsageCard } from './memory-usage-card';

describe('MemoryUsageCard', () => {
  let fixture: ComponentFixture<MemoryUsageCard>;
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
      imports: [MemoryUsageCard],
      providers: [SystemMonitorReadings, SystemMonitorProcesses],
    }).compileComponents();
    readings = TestBed.inject(SystemMonitorReadings);
    listing = TestBed.inject(SystemMonitorProcesses);
    fixture = TestBed.createComponent(MemoryUsageCard);
    host = fixture.nativeElement as HTMLElement;
  });

  afterEach(() => {
    globalThis.localStorage?.clear();
  });

  it('metersMemoryInUse_withStudiosShareNested_andListsItsParts', async () => {
    readings.accept(MEMORY_SAMPLE);
    await settle();

    expect(host.querySelector('[role="meter"]')?.getAttribute('aria-label')).toBe(
      'In Use: 19%; Studio: 0.3%',
    );
    const labels: string[] = Array.from(host.querySelectorAll('dt')).map(
      (term: Element): string => term.textContent?.trim() ?? '',
    );
    expect(labels).toEqual(['In Use', 'Studio', 'Compressed', 'Available', 'Total']);
    expect(listing).toBeDefined();
  });
});
