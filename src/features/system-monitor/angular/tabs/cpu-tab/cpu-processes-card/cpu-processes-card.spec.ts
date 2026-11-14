import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { ProcessSample } from '@shared/api/system-monitor-channels';
import { SystemMonitorProcesses } from '../../../readings/system-monitor-processes';
import { CpuProcessesCard } from './cpu-processes-card';

/**
 * Builds a listed process.
 * @param pid The process id.
 * @param cpuPercent Its CPU share.
 * @param over Any other fields.
 * @returns Returns the process.
 */
function process(
  pid: number,
  cpuPercent: number,
  over: Partial<ProcessSample> = {},
): ProcessSample {
  return {
    pid,
    parentPid: 1,
    name: `p${pid}`,
    command: `p${pid}`,
    user: 'me',
    cpuPercent,
    memoryBytes: 1024 ** 2,
    memoryPercent: 0,
    ...over,
  };
}

describe('CpuProcessesCard', () => {
  let fixture: ComponentFixture<CpuProcessesCard>;
  let host: HTMLElement;
  let listing: SystemMonitorProcesses;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CpuProcessesCard],
      providers: [SystemMonitorProcesses],
    }).compileComponents();
    listing = TestBed.inject(SystemMonitorProcesses);
    fixture = TestBed.createComponent(CpuProcessesCard);
    host = fixture.nativeElement as HTMLElement;
  });

  it('listsTheFiveBusiestByCpu_withTheirThreadsAndCpuTime', async () => {
    listing.accept({
      timestamp: 't',
      total: 7,
      processes: [
        // The listing keeps Studio's own first; the card orders by CPU alone.
        process(1, 0.1),
        process(2, 8.4, { threads: 68, cpuTimeSeconds: 763 }),
        process(3, 2.1),
        process(4, 1.0),
        process(5, 0.9),
        process(6, 0.5),
        process(7, 0.05),
      ],
    });
    fixture.detectChanges();
    await fixture.whenStable();

    const rows: NodeListOf<HTMLTableRowElement> = host.querySelectorAll(
      '[data-testid="cpu-processes"] tbody tr',
    );
    expect(rows).toHaveLength(5);
    expect(rows[0].textContent).toContain('p2');
    expect(rows[0].textContent).toContain('68');
    expect(rows[0].textContent).toContain('12m 43s');
    // Where the platform could not read them, the cells say so.
    expect(rows[1].textContent).toContain('—');
  });
});
