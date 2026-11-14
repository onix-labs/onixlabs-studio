import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SystemMonitorProcesses } from '../../../readings/system-monitor-processes';
import { SystemMonitorReadings } from '../../../readings/system-monitor-readings';
import { MEMORY_SAMPLE } from '../memory-test-sample';
import { MemoryCompositionCard } from './memory-composition-card';

describe('MemoryCompositionCard', () => {
  let fixture: ComponentFixture<MemoryCompositionCard>;
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
      imports: [MemoryCompositionCard],
      providers: [SystemMonitorReadings, SystemMonitorProcesses],
    }).compileComponents();
    readings = TestBed.inject(SystemMonitorReadings);
    listing = TestBed.inject(SystemMonitorProcesses);
    fixture = TestBed.createComponent(MemoryCompositionCard);
    host = fixture.nativeElement as HTMLElement;
  });

  afterEach(() => {
    globalThis.localStorage?.clear();
  });

  it('stacksEveryPartButFree_andNamesThemTopFirst', async () => {
    readings.accept(MEMORY_SAMPLE);
    await settle();

    expect(host.querySelectorAll('path')).toHaveLength(4);
    const names: string[] = Array.from(
      host.querySelectorAll('[data-testid="memory-composition-legend"] li'),
    ).map(
      (item: Element): string => item.textContent?.replace(/\s+/g, ' ').trim().split(' ')[0] ?? '',
    );
    expect(names).toEqual(['Free', 'Cached', 'Compressed', 'Wired', 'Apps']);
    expect(host.querySelector('.stacked-area-chart__tick')?.textContent?.trim()).toBe('256 GB');
    expect(listing).toBeDefined();
  });
});
