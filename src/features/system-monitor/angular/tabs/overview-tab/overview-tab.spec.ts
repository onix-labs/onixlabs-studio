import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SystemMonitorReadings } from '../../readings/system-monitor-readings';
import { SystemMonitorTabId } from '../system-monitor-tab-id';
import { OverviewTab } from './overview-tab';

describe('OverviewTab', () => {
  let fixture: ComponentFixture<OverviewTab>;
  let host: HTMLElement;
  let readings: SystemMonitorReadings;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OverviewTab],
      providers: [SystemMonitorReadings],
    }).compileComponents();
    readings = TestBed.inject(SystemMonitorReadings);
    fixture = TestBed.createComponent(OverviewTab);
    host = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  afterEach(() => {
    globalThis.localStorage?.clear();
  });

  it('describesTheMachineInALine_onceItIsKnown', async () => {
    expect(host.textContent).not.toContain('·');

    readings.setInfo({
      cpuModel: 'Test CPU',
      logicalCores: 8,
      totalMemoryBytes: 16 * 1024 ** 3,
      os: 'TestOS 1',
    });
    fixture.detectChanges();
    await fixture.whenStable();

    expect(host.textContent).toContain('Test CPU · 8 cores · 16.0 GB · TestOS 1');
  });

  it('opensAResourcesTab_whenItsGraphIsPressed', () => {
    const opened: SystemMonitorTabId[] = [];
    fixture.componentInstance.open.subscribe((tab: SystemMonitorTabId): void => {
      opened.push(tab);
    });

    host.querySelector<HTMLButtonElement>('[aria-label="Open Memory"]')?.click();
    host.querySelector<HTMLButtonElement>('[aria-label="Open Network"]')?.click();

    expect(opened).toEqual([SystemMonitorTabId.Memory, SystemMonitorTabId.Network]);
  });
});
