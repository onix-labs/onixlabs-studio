import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SystemInfo } from '@shared/api/system-monitor-channels';
import { SystemMonitorProcesses } from '../../readings/system-monitor-processes';
import { SystemMonitorReadings } from '../../readings/system-monitor-readings';
import { CpuTab } from './cpu-tab';

/**
 * Describes a machine for the tests, overridable per test.
 * @param over The fields to override.
 * @returns Returns the description.
 */
function machine(over: Partial<SystemInfo> = {}): SystemInfo {
  return {
    cpuModel: 'Intel(R) Xeon(R) W-3265 CPU @ 2.70GHz',
    logicalCores: 48,
    physicalCores: 24,
    speedGhz: 2.7,
    totalMemoryBytes: 256 * 1024 ** 3,
    os: 'macOS 26.7.3',
    architecture: 'x86_64',
    caches: [],
    gpus: [],
    memoryModules: [],
    ...over,
  };
}

describe('CpuTab', () => {
  let fixture: ComponentFixture<CpuTab>;
  let host: HTMLElement;
  let readings: SystemMonitorReadings;

  /**
   * Gets the header's chips, as read.
   * @returns Returns each chip's text.
   */
  function chips(): string[] {
    return Array.from(host.querySelectorAll('[aria-label="Summary"] li')).map(
      (chip: Element): string => chip.textContent?.replace(/\s+/g, ' ').trim() ?? '',
    );
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CpuTab],
      providers: [SystemMonitorReadings, SystemMonitorProcesses],
    }).compileComponents();
    readings = TestBed.inject(SystemMonitorReadings);
    fixture = TestBed.createComponent(CpuTab);
    host = fixture.nativeElement as HTMLElement;
  });

  afterEach(() => {
    globalThis.localStorage?.clear();
  });

  it('namesTheProcessor_withItsHeadlineFacts', async () => {
    readings.setInfo(machine());
    fixture.detectChanges();
    await fixture.whenStable();

    expect(host.textContent).toContain('Intel(R) Xeon(R) W-3265 CPU @ 2.70GHz');
    expect(chips()).toEqual([
      '48 Logical Cores',
      '24 Physical Cores',
      '2.70 GHz Base',
      '256.0 GB RAM',
    ]);
  });

  it('showsTheMaximumFrequency_onlyWhereThePlatformReportsOne', async () => {
    readings.setInfo(machine({ maxSpeedGhz: 4.4 }));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(chips()).toContain('4.40 GHz Max (Turbo)');
  });

  it('laysOutTheSketchsCards', () => {
    fixture.detectChanges();

    const cards: string[] = Array.from(host.querySelectorAll('article')).map(
      (card: Element): string => card.getAttribute('aria-label') ?? '',
    );
    expect(cards).toEqual([
      'Total Utilisation',
      'CPU Information',
      'Utilisation by Core',
      'Core Utilisation (Grouped)',
      'Top Processes by CPU',
    ]);
  });
});
