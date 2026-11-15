import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SystemMonitorProcesses } from '../../readings/system-monitor-processes';
import { SystemMonitorReadings } from '../../readings/system-monitor-readings';
import { MemoryTab } from './memory-tab';
import { MEMORY_SAMPLE } from './memory-test-sample';

describe('MemoryTab', () => {
  let fixture: ComponentFixture<MemoryTab>;
  let host: HTMLElement;
  let readings: SystemMonitorReadings;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MemoryTab],
      providers: [SystemMonitorReadings, SystemMonitorProcesses],
    }).compileComponents();
    readings = TestBed.inject(SystemMonitorReadings);
    fixture = TestBed.createComponent(MemoryTab);
    host = fixture.nativeElement as HTMLElement;
  });

  afterEach(() => {
    globalThis.localStorage?.clear();
  });

  it('namesTheMemory_withItsHeadlineReadings', async () => {
    readings.setInfo({
      cpuModel: 'CPU',
      logicalCores: 1,
      totalMemoryBytes: 256 * 1024 ** 3,
      os: 'macOS',
      architecture: 'x86_64',
      caches: [],
      gpus: [],
      memoryModules: [
        {
          slot: 'DIMM 1',
          sizeBytes: 32 * 1024 ** 3,
          type: 'DDR4 R-DIMM',
          speedMts: 2400,
          manufacturer: '',
          partNumber: '',
        },
      ],
      memoryEcc: true,
    });
    readings.accept(MEMORY_SAMPLE);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(host.textContent).toContain('256.0 GB DDR4 ECC');
    const chips: string[] = Array.from(host.querySelectorAll('[aria-label="Summary"] li')).map(
      (chip: Element): string =>
        `${chip.querySelector('.view-summary__label')?.textContent?.trim() ?? ''} ${chip.querySelector('.view-summary__value')?.textContent?.trim() ?? ''}`,
    );
    expect(chips).toEqual([
      'In Use 49.0 GB (19%)',
      'Available 207.0 GB',
      'Compressed 512.0 MB',
      'Swap 0 B',
      'Speed 2400 MT/s',
    ]);
  });

  it('laysOutTheSketchsCards', () => {
    fixture.detectChanges();

    expect(
      Array.from(host.querySelectorAll('article')).map(
        (card: Element): string => card.getAttribute('aria-label') ?? '',
      ),
    ).toEqual([
      'Memory Usage',
      'Memory Usage (Last 60 seconds)',
      'Memory Pressure',
      'Memory Breakdown',
      'Swap',
      'Memory Usage by Process',
      'Memory Composition',
      'Physical Memory (DIMMs)',
      'Memory Statistics',
    ]);
  });
});
