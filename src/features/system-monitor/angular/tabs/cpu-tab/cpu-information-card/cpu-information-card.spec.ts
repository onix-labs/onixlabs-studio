import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SystemInfo } from '@shared/api/system-monitor-channels';
import { SystemMonitorReadings } from '../../../readings/system-monitor-readings';
import { CpuInformationCard } from './cpu-information-card';

describe('CpuInformationCard', () => {
  let fixture: ComponentFixture<CpuInformationCard>;
  let host: HTMLElement;
  let readings: SystemMonitorReadings;

  /**
   * Describes the machine and gets the card's rows.
   * @param info The machine.
   * @returns Returns each row as `label: value`.
   */
  async function rows(info: SystemInfo): Promise<string[]> {
    readings.setInfo(info);
    fixture.detectChanges();
    await fixture.whenStable();
    return Array.from(host.querySelectorAll('[data-testid="cpu-information"] > div')).map(
      (row: Element): string =>
        `${row.querySelector('dt')?.textContent?.trim()}: ${row.querySelector('dd')?.textContent?.trim()}`,
    );
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CpuInformationCard],
      providers: [SystemMonitorReadings],
    }).compileComponents();
    readings = TestBed.inject(SystemMonitorReadings);
    fixture = TestBed.createComponent(CpuInformationCard);
    host = fixture.nativeElement as HTMLElement;
  });

  afterEach(() => {
    globalThis.localStorage?.clear();
  });

  it('describesTheProcessor_withEachPerCoreCachesBreakdown', async () => {
    expect(
      await rows({
        cpuModel: 'Intel Xeon W-3265',
        logicalCores: 48,
        physicalCores: 24,
        speedGhz: 2.7,
        totalMemoryBytes: 1,
        os: 'macOS',
        architecture: 'x86_64',
        caches: [
          { level: 'L1', totalBytes: 24 * 64 * 1024, perCoreBytes: 64 * 1024 },
          { level: 'L2', totalBytes: 24 * 1024 ** 2, perCoreBytes: 1024 ** 2 },
          { level: 'L3', totalBytes: 33 * 1024 ** 2 },
        ],
        gpus: [],
      }),
    ).toEqual([
      'Model: Intel Xeon W-3265',
      'Architecture: x86_64',
      'Cores (Physical): 24',
      'Cores (Logical): 48',
      'Base Frequency: 2.70 GHz',
      'L1 Cache: 1.5 MB (24 × 64 KB)',
      'L2 Cache: 24 MB (24 × 1 MB)',
      'L3 Cache: 33 MB',
    ]);
  });

  it('addsTheMaximumFrequencyAndHybridSplit_onlyWhereReported', async () => {
    const described: string[] = await rows({
      cpuModel: 'Hybrid',
      logicalCores: 12,
      physicalCores: 10,
      performanceCores: 2,
      efficiencyCores: 8,
      speedGhz: 1.2,
      maxSpeedGhz: 4.7,
      totalMemoryBytes: 1,
      os: 'Windows',
      architecture: 'x86_64',
      caches: [],
      gpus: [],
    });

    expect(described).toContain('Performance / Efficiency: 2 / 8');
    expect(described).toContain('Max Frequency (Turbo): 4.70 GHz');
  });
});
