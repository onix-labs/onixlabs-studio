import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SystemMonitorProcesses } from '../../readings/system-monitor-processes';
import { SystemMonitorReadings } from '../../readings/system-monitor-readings';
import { OverviewTab } from './overview-tab';

describe('OverviewTab', () => {
  let fixture: ComponentFixture<OverviewTab>;
  let host: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OverviewTab],
      providers: [SystemMonitorReadings, SystemMonitorProcesses],
    }).compileComponents();
    fixture = TestBed.createComponent(OverviewTab);
    host = fixture.nativeElement as HTMLElement;
    fixture.componentRef.setInput('logs', { info: 0, warnings: 0, errors: 0, recent: [] });
    fixture.detectChanges();
    await fixture.whenStable();
  });

  afterEach(() => {
    globalThis.localStorage?.clear();
  });

  it('leadsWithTheLiveResources_thenTheSlowerMovingOnes', () => {
    const cards: string[] = Array.from(host.querySelectorAll('article')).map(
      (card: Element): string => card.getAttribute('aria-label') ?? '',
    );

    expect(cards).toEqual([
      'CPU',
      'Memory',
      'GPU',
      'Network',
      'Storage',
      'Processes',
      'System',
      'Logs',
    ]);
    expect(host.querySelector('article footer')).toBeNull();
  });
});
