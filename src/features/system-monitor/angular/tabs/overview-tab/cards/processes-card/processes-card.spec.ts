import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { ProcessSample } from '@shared/api/system-monitor-channels';
import { SystemMonitorProcesses } from '../../../../readings/system-monitor-processes';
import { ProcessesCard } from './processes-card';

/**
 * Builds a listed process.
 * @param pid The process id.
 * @param name The process's name.
 * @returns Returns the process.
 */
function process(pid: number, name: string): ProcessSample {
  return {
    pid,
    parentPid: 1,
    name,
    command: name,
    user: 'me',
    cpuPercent: 1,
    memoryBytes: 1024,
    memoryPercent: 0,
  };
}

describe('ProcessesCard', () => {
  let fixture: ComponentFixture<ProcessesCard>;
  let host: HTMLElement;
  let listing: SystemMonitorProcesses;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ProcessesCard],
      providers: [SystemMonitorProcesses],
    }).compileComponents();
    listing = TestBed.inject(SystemMonitorProcesses);
    fixture = TestBed.createComponent(ProcessesCard);
    host = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('saysItIsListing_untilTheFirstListingArrives', () => {
    expect(host.textContent).toContain('Listing processes…');
  });

  it('countsEveryProcess_andListsTheEightBusiest', async () => {
    listing.accept({
      timestamp: 't',
      total: 712,
      user: 'me',
      processes: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((pid: number): ProcessSample =>
        process(pid, `p${pid}`),
      ),
    });
    fixture.detectChanges();
    await fixture.whenStable();

    expect(host.textContent).toContain('712');
    expect(host.querySelectorAll('[data-testid="processes-card-table"] tbody tr')).toHaveLength(8);
  });
});
