import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SystemMonitorProcesses } from '../../../readings/system-monitor-processes';
import { SystemMonitorReadings } from '../../../readings/system-monitor-readings';
import { MemoryProcessesCard } from './memory-processes-card';

describe('MemoryProcessesCard', () => {
  let fixture: ComponentFixture<MemoryProcessesCard>;
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
      imports: [MemoryProcessesCard],
      providers: [SystemMonitorReadings, SystemMonitorProcesses],
    }).compileComponents();
    readings = TestBed.inject(SystemMonitorReadings);
    listing = TestBed.inject(SystemMonitorProcesses);
    fixture = TestBed.createComponent(MemoryProcessesCard);
    host = fixture.nativeElement as HTMLElement;
  });

  afterEach(() => {
    globalThis.localStorage?.clear();
  });

  it('listsTheFiveHoldingTheMostMemory', async () => {
    listing.accept({
      timestamp: 't',
      total: 6,
      user: 'me',
      processes: [1, 2, 3, 4, 5, 6].map((pid: number) => ({
        pid,
        parentPid: 1,
        name: `p${pid}`,
        command: `p${pid}`,
        user: 'me',
        cpuPercent: 7 - pid,
        memoryBytes: pid * 1024 ** 2,
        memoryPercent: pid / 10,
      })),
    });
    await settle();

    const rows: NodeListOf<HTMLTableRowElement> = host.querySelectorAll(
      '[data-testid="memory-processes"] tbody tr',
    );
    expect(rows).toHaveLength(5);
    expect(rows[0].textContent).toContain('p6');
    expect(rows[0].textContent).toContain('0.6%');
    expect(readings).toBeDefined();
  });
});
