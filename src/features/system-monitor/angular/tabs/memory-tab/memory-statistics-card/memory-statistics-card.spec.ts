import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SystemMonitorProcesses } from '../../../readings/system-monitor-processes';
import { SystemMonitorReadings } from '../../../readings/system-monitor-readings';
import { MEMORY_SAMPLE } from '../memory-test-sample';
import { MemoryStatisticsCard } from './memory-statistics-card';

describe('MemoryStatisticsCard', () => {
  let fixture: ComponentFixture<MemoryStatisticsCard>;
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
      imports: [MemoryStatisticsCard],
      providers: [SystemMonitorReadings, SystemMonitorProcesses],
    }).compileComponents();
    readings = TestBed.inject(SystemMonitorReadings);
    listing = TestBed.inject(SystemMonitorProcesses);
    fixture = TestBed.createComponent(MemoryStatisticsCard);
    host = fixture.nativeElement as HTMLElement;
  });

  afterEach(() => {
    globalThis.localStorage?.clear();
  });

  it('listsTheFiguresThePlatformReports', async () => {
    readings.accept(MEMORY_SAMPLE);
    await settle();

    const labels: string[] = Array.from(host.querySelectorAll('dt')).map(
      (term: Element): string => term.textContent?.trim() ?? '',
    );
    expect(labels).toEqual([
      'Total Physical Memory',
      'In Use',
      'Available',
      'App Memory',
      'Wired',
      'Compressed',
      'Cached Files',
      'Free',
      'Swap Total',
      'Swap Used',
      'Page Ins (Since Boot)',
      'Page Outs (Since Boot)',
    ]);
    expect(host.textContent).toContain((10243683).toLocaleString());
    expect(listing).toBeDefined();
  });
});
