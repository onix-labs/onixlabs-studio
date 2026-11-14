import { describe, expect, it } from 'vitest';
import { ProcessesSnapshot, ProcessSample } from '@shared/api/system-monitor-channels';
import { PROCESS_HISTORY, SystemMonitorProcesses } from './system-monitor-processes';

/**
 * Builds a listed process.
 * @param pid The process id.
 * @param cpuPercent The CPU share.
 * @param name The process's name.
 * @returns Returns the process.
 */
function process(pid: number, cpuPercent: number, name: string = `p${pid}`): ProcessSample {
  return {
    pid,
    parentPid: 1,
    name,
    command: name,
    user: 'me',
    cpuPercent,
    memoryBytes: pid * 100,
    memoryPercent: 1,
  };
}

/**
 * Builds a snapshot of the given processes.
 * @param processes The processes listed.
 * @returns Returns the snapshot.
 */
function snapshot(...processes: ProcessSample[]): ProcessesSnapshot {
  return { timestamp: 't', total: processes.length, processes };
}

describe('SystemMonitorProcesses', () => {
  it('keepsAHistoryPerProcess_forTheChosenOnesGraphs', () => {
    const listing: SystemMonitorProcesses = new SystemMonitorProcesses();
    listing.accept(snapshot(process(7, 1), process(8, 2)));
    listing.accept(snapshot(process(7, 3), process(8, 4)));

    listing.select(7);

    expect(listing.selected()?.process.cpuPercent).toBe(3);
    expect(listing.selectedHistory()).toEqual({ cpu: [1, 3], memory: [700, 700] });
  });

  it('dropsTheHistoryOfAProcessNoLongerListed', () => {
    const listing: SystemMonitorProcesses = new SystemMonitorProcesses();
    listing.accept(snapshot(process(7, 1)));
    listing.accept(snapshot(process(8, 1)));
    listing.accept(snapshot(process(7, 5)));

    listing.select(7);

    expect(listing.selectedHistory().cpu).toEqual([5]);
  });

  it('startsAFreshHistory_whenAPidIsReusedByAnotherProcess', () => {
    const listing: SystemMonitorProcesses = new SystemMonitorProcesses();
    listing.accept(snapshot(process(7, 1, 'old')));
    listing.accept(snapshot(process(7, 9, 'new')));

    listing.select(7);

    expect(listing.selectedHistory().cpu).toEqual([9]);
  });

  it('holdsEachHistoryToItsLength', () => {
    const listing: SystemMonitorProcesses = new SystemMonitorProcesses();
    for (let cpu: number = 0; cpu < PROCESS_HISTORY + 5; cpu += 1) {
      listing.accept(snapshot(process(7, cpu)));
    }

    listing.select(7);

    expect(listing.selectedHistory().cpu).toHaveLength(PROCESS_HISTORY);
    expect(listing.selectedHistory().cpu.at(-1)).toBe(PROCESS_HISTORY + 4);
  });

  it('keepsTheChosenProcess_frozenAndMarkedUnlisted_onceItIsNoLongerListed', () => {
    const listing: SystemMonitorProcesses = new SystemMonitorProcesses();
    listing.accept(snapshot(process(7, 1)));
    listing.select(7);
    listing.accept(snapshot(process(7, 4)));
    listing.accept(snapshot(process(8, 1)));

    expect(listing.selected()?.listed).toBe(false);
    expect(listing.selected()?.process.cpuPercent).toBe(4);
    expect(listing.selectedHistory().cpu).toEqual([1, 4]);
  });

  it('select_ignoresAProcessNotListed', () => {
    const listing: SystemMonitorProcesses = new SystemMonitorProcesses();
    listing.accept(snapshot(process(7, 1)));

    listing.select(99);

    expect(listing.selected()).toBeNull();
    expect(listing.selectedPid()).toBeNull();
  });
});
