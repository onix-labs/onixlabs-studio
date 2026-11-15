import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SystemMonitorProcesses } from '../../../readings/system-monitor-processes';
import { SystemMonitorReadings } from '../../../readings/system-monitor-readings';
import { MEMORY_SAMPLE } from '../memory-test-sample';
import { MemoryBreakdownCard } from './memory-breakdown-card';

describe('MemoryBreakdownCard', () => {
  let fixture: ComponentFixture<MemoryBreakdownCard>;
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
      imports: [MemoryBreakdownCard],
      providers: [SystemMonitorReadings, SystemMonitorProcesses],
    }).compileComponents();
    readings = TestBed.inject(SystemMonitorReadings);
    listing = TestBed.inject(SystemMonitorProcesses);
    fixture = TestBed.createComponent(MemoryBreakdownCard);
    host = fixture.nativeElement as HTMLElement;
  });

  afterEach(() => {
    globalThis.localStorage?.clear();
  });

  it('barsEachPart_andNamesItWithItsSizeAndShare', async () => {
    readings.accept(MEMORY_SAMPLE);
    await settle();

    expect(host.querySelectorAll('[data-testid="memory-breakdown"] > div')).toHaveLength(5);
    const items: string[] = Array.from(host.querySelectorAll('li')).map(
      (item: Element): string => item.textContent?.replace(/\s+/g, ' ').trim() ?? '',
    );
    expect(items[0]).toBe('Apps 36.0 GB (14%)');
    expect(items.map((item: string): string => item.split(' ')[0])).toEqual([
      'Apps',
      'Wired',
      'Compressed',
      'Cached',
      'Free',
    ]);
    expect(listing).toBeDefined();
  });
});
