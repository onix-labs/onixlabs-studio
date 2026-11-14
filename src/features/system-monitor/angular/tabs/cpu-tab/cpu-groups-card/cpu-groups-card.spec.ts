import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SystemMonitorReadings } from '../../../readings/system-monitor-readings';
import { CpuGroupsCard, groupSize } from './cpu-groups-card';

describe('groupSize', () => {
  it('groupsEightOnALargeCpu_andFewerOnASmallOne', () => {
    expect(groupSize(48)).toBe(8);
    expect(groupSize(12)).toBe(4);
    expect(groupSize(4)).toBe(2);
  });
});

describe('CpuGroupsCard', () => {
  let fixture: ComponentFixture<CpuGroupsCard>;
  let host: HTMLElement;
  let readings: SystemMonitorReadings;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CpuGroupsCard],
      providers: [SystemMonitorReadings],
    }).compileComponents();
    readings = TestBed.inject(SystemMonitorReadings);
    fixture = TestBed.createComponent(CpuGroupsCard);
    host = fixture.nativeElement as HTMLElement;
  });

  afterEach(() => {
    globalThis.localStorage?.clear();
  });

  it('barsEachRunOfCores_atItsAverageLoad', async () => {
    readings.accept({
      timestamp: 't',
      cpu: 10,
      memory: { usedBytes: 1, totalBytes: 2, percent: 50 },
      // Twelve cores, so runs of four.
      cores: [10, 20, 30, 40, 0, 0, 0, 0, 100, 100, 50, 50],
    });
    fixture.detectChanges();
    await fixture.whenStable();

    const groups: string[] = Array.from(host.querySelectorAll('[data-testid="cpu-groups"] li')).map(
      (group: Element): string =>
        `${group.querySelector('span')?.textContent?.trim()} ${group.querySelector('[role="meter"] + span')?.textContent?.trim()}`,
    );
    expect(groups).toEqual(['Cores 1 – 4 25%', 'Cores 5 – 8 0%', 'Cores 9 – 12 75%']);
  });
});
