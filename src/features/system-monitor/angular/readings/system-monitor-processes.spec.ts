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
  return { timestamp: 't', total: processes.length, processes, user: 'me' };
}

describe('SystemMonitorProcesses', () => {
  it('keepsAHistoryPerProcess_forItsGraphs', () => {
    const listing: SystemMonitorProcesses = new SystemMonitorProcesses();
    listing.accept(snapshot(process(7, 1), process(8, 2)));
    listing.accept(snapshot(process(7, 3), process(8, 4)));

    expect(listing.allHistories().get(7)).toEqual({
      cpu: [1, 3],
      memory: [700, 700],
      gpu: [0, 0],
    });
    expect(listing.processes().map((each: ProcessSample): number => each.cpuPercent)).toEqual([
      3, 4,
    ]);
  });

  it('dropsTheHistoryOfAProcessNoLongerListed', () => {
    const listing: SystemMonitorProcesses = new SystemMonitorProcesses();
    listing.accept(snapshot(process(7, 1)));
    listing.accept(snapshot(process(8, 1)));
    listing.accept(snapshot(process(7, 5)));

    expect(listing.allHistories().get(7)?.cpu).toEqual([5]);
    expect(listing.allHistories().has(8)).toBe(false);
  });

  it('startsAFreshHistory_whenAPidIsReusedByAnotherProcess', () => {
    const listing: SystemMonitorProcesses = new SystemMonitorProcesses();
    listing.accept(snapshot(process(7, 1, 'old')));
    listing.accept(snapshot(process(7, 9, 'new')));

    expect(listing.allHistories().get(7)?.cpu).toEqual([9]);
  });

  it('holdsEachHistoryToItsLength', () => {
    const listing: SystemMonitorProcesses = new SystemMonitorProcesses();
    for (let cpu: number = 0; cpu < PROCESS_HISTORY + 5; cpu += 1) {
      listing.accept(snapshot(process(7, cpu)));
    }

    const cpu: readonly number[] = listing.allHistories().get(7)?.cpu ?? [];
    expect(cpu).toHaveLength(PROCESS_HISTORY);
    expect(cpu.at(-1)).toBe(PROCESS_HISTORY + 4);
  });

  it('select_choosesAListedProcess_andIgnoresOneNotListed', () => {
    const listing: SystemMonitorProcesses = new SystemMonitorProcesses();
    listing.accept(snapshot(process(7, 1)));

    listing.select(7);
    expect(listing.selectedPid()).toBe(7);

    listing.select(99);
    expect(listing.selectedPid()).toBeNull();

    listing.select(7);
    listing.select(null);
    expect(listing.selectedPid()).toBeNull();
  });

  it('recordsEachProcesssGpuShare_withTheNextListing', () => {
    const listing: SystemMonitorProcesses = new SystemMonitorProcesses();
    listing.accept(snapshot(process(7, 1)));
    listing.acceptGpu({ timestamp: 't', engines: [], processes: [{ pid: 7, gpuPercent: 12 }] });
    listing.accept(snapshot(process(7, 1), process(8, 1)));

    expect(listing.allHistories().get(7)?.gpu).toEqual([0, 12]);
    expect(listing.allHistories().get(8)?.gpu).toEqual([0]);
  });

  it('keepsTheLastGpuShares_throughAReadingThatNamesNone', () => {
    const listing: SystemMonitorProcesses = new SystemMonitorProcesses();
    listing.acceptGpu({ timestamp: 't', engines: [], processes: [{ pid: 7, gpuPercent: 12 }] });
    listing.acceptGpu({ timestamp: 't', engines: [], processes: [{ pid: 7 }] });

    expect(listing.gpuShares()?.get(7)).toBe(12);
  });
});
