import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SystemMonitorProcesses } from '../../../readings/system-monitor-processes';
import { SystemMonitorReadings } from '../../../readings/system-monitor-readings';
import { MemoryModulesCard } from './memory-modules-card';

describe('MemoryModulesCard', () => {
  let fixture: ComponentFixture<MemoryModulesCard>;
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
      imports: [MemoryModulesCard],
      providers: [SystemMonitorReadings, SystemMonitorProcesses],
    }).compileComponents();
    readings = TestBed.inject(SystemMonitorReadings);
    listing = TestBed.inject(SystemMonitorProcesses);
    fixture = TestBed.createComponent(MemoryModulesCard);
    host = fixture.nativeElement as HTMLElement;
  });

  afterEach(() => {
    globalThis.localStorage?.clear();
  });

  it('listsEachModule_countingTheSlotsFilled', async () => {
    readings.setInfo({
      cpuModel: 'CPU',
      logicalCores: 1,
      totalMemoryBytes: 1,
      os: 'macOS',
      architecture: 'x86_64',
      caches: [],
      gpus: [],
      memoryModules: [
        {
          slot: 'Slot 3 (Channel E / DIMM 1)',
          sizeBytes: 32 * 1024 ** 3,
          type: 'DDR4 R-DIMM',
          speedMts: 2400,
          status: 'OK',
          manufacturer: 'Samsung',
          partNumber: 'M393A4K40CB1-CRC',
        },
      ],
      memorySlots: 12,
    });
    await settle();

    expect(host.querySelector('article')?.getAttribute('aria-label')).toBe(
      'Physical Memory (1 of 12 slots)',
    );
    const cells: string[] = Array.from(
      host.querySelectorAll('[data-testid="memory-modules"] tbody tr td'),
    ).map((cell: Element): string => cell.textContent?.trim() ?? '');
    expect(cells).toEqual([
      'Slot 3 (Channel E / DIMM 1)',
      '32 GB',
      'DDR4 R-DIMM',
      '2400 MT/s',
      'OK',
    ]);
  });

  it('saysWhy_whereThePlatformReportsNoModules', async () => {
    readings.setInfo({
      cpuModel: 'CPU',
      logicalCores: 1,
      totalMemoryBytes: 1,
      os: 'Linux',
      architecture: 'x86_64',
      caches: [],
      gpus: [],
      memoryModules: [],
    });
    await settle();

    expect(host.textContent).toContain('administrator rights');
    expect(listing).toBeDefined();
  });
});
