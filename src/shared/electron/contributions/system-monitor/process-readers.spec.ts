import { describe, expect, it } from 'vitest';
import { ProcessSample, StudioProcessKind } from '@shared/api/system-monitor-channels';
import {
  ElectronProcess,
  parseStarted,
  ProcessMachine,
  ProcessStat,
  readProcesses,
  studioProcesses,
} from './process-readers';

/**
 * Builds a process stat.
 * @param pid The process id.
 * @param parentPid The parent's process id.
 * @param cpu The CPU reading.
 * @param memRssKb The resident memory, in kilobytes.
 * @returns Returns the stat.
 */
function stat(pid: number, parentPid: number, cpu: number = 0, memRssKb: number = 0): ProcessStat {
  return { pid, parentPid, name: `p${pid}`, command: `/bin/p${pid}`, cpu, memRss: memRssKb };
}

/**
 * A four-core machine with 1 MiB of memory, whose listing reports CPU as a machine share.
 */
const MACHINE: ProcessMachine = {
  mainPid: 10,
  coreCount: 4,
  totalBytes: 1024 * 1024,
  cpuIsPerCore: false,
};

describe('studioProcesses', () => {
  it('marksElectronsOwnByType_andEverythingDescendedFromMainAsAChild', () => {
    const stats: readonly ProcessStat[] = [
      stat(1, 0),
      stat(10, 1),
      stat(11, 10),
      stat(12, 10),
      stat(20, 12), // a shell a renderer's utility started
      stat(21, 20), // the build that shell runs
      stat(30, 1), // unrelated
    ];
    const electron: readonly ElectronProcess[] = [
      { pid: 10, type: 'Browser' },
      { pid: 11, type: 'Tab' },
      { pid: 12, type: 'Utility' },
    ];

    const kinds: ReadonlyMap<number, StudioProcessKind> = studioProcesses(stats, electron, 10);

    expect(Object.fromEntries(kinds)).toEqual({
      10: 'main',
      11: 'renderer',
      12: 'utility',
      20: 'child',
      21: 'child',
    });
  });

  it('survivesACycleInARacyListing', () => {
    const stats: readonly ProcessStat[] = [stat(10, 1), stat(20, 30), stat(30, 20), stat(40, 10)];

    const kinds: ReadonlyMap<number, StudioProcessKind> = studioProcesses(stats, [], 10);

    expect([...kinds.keys()].sort()).toEqual([10, 40]);
  });
});

describe('readProcesses', () => {
  it('scalesPerCoreCpu_toAShareOfTheMachine', () => {
    const [process]: readonly ProcessSample[] = readProcesses(
      [stat(50, 1, 200)],
      [],
      { ...MACHINE, cpuIsPerCore: true },
      10,
    );

    // 200% of one core on a four-core machine is half the machine.
    expect(process.cpuPercent).toBe(50);
  });

  it('keepsAMachineShare_asReported', () => {
    const [process]: readonly ProcessSample[] = readProcesses(
      [stat(50, 1, 37.25)],
      [],
      MACHINE,
      10,
    );

    expect(process.cpuPercent).toBe(37.3);
  });

  it('convertsResidentKilobytes_toBytesAndAShareOfMemory', () => {
    const [process]: readonly ProcessSample[] = readProcesses(
      [stat(50, 1, 0, 256)],
      [],
      MACHINE,
      10,
    );

    expect(process.memoryBytes).toBe(256 * 1024);
    expect(process.memoryPercent).toBe(25);
  });

  it('keepsEveryStudioProcess_andFillsTheRestWithTheBusiest', () => {
    const stats: readonly ProcessStat[] = [
      stat(10, 1, 1),
      stat(11, 10, 0), // idle, but Studio's
      stat(60, 1, 5),
      stat(61, 1, 40),
      stat(62, 1, 20),
    ];

    const processes: readonly ProcessSample[] = readProcesses(stats, [], MACHINE, 4);

    expect(processes.map((process: ProcessSample): number => process.pid)).toEqual([
      61, 62, 10, 11,
    ]);
    expect(processes.find((process: ProcessSample): boolean => process.pid === 11)?.studio).toBe(
      'child',
    );
    expect(processes.find((process: ProcessSample): boolean => process.pid === 61)?.studio).toBe(
      undefined,
    );
  });

  it('joinsTheCommandAndItsParameters_fallingBackToTheName', () => {
    const processes: readonly ProcessSample[] = readProcesses(
      [
        {
          pid: 70,
          parentPid: 1,
          name: 'node',
          command: 'node',
          params: 'server.js',
          cpu: 1,
          memRss: 0,
        },
        { pid: 71, parentPid: 1, name: 'kernel_task', cpu: 0, memRss: 0 },
      ],
      [],
      MACHINE,
      10,
    );

    expect(processes.map((process: ProcessSample): string => process.command)).toEqual([
      'node server.js',
      'kernel_task',
    ]);
  });

  it('leavesOutTheMonitorsOwnTools_butNotTheSameToolRunElsewhere', () => {
    const processes: readonly ProcessSample[] = readProcesses(
      [stat(10, 1), { ...stat(20, 10, 5), name: 'ps' }, { ...stat(30, 1, 5), name: 'ps' }],
      [],
      MACHINE,
      10,
    );

    expect(processes.map((process: ProcessSample): number => process.pid)).toEqual([30, 10]);
  });
});

describe('parseStarted', () => {
  it('readsTheLocalStartTime', () => {
    expect(parseStarted('2026-11-13 19:09:29')).toBe(new Date(2026, 10, 13, 19, 9, 29).getTime());
  });

  it('findsNoTime_whereThereIsNoneToRead', () => {
    expect(parseStarted(undefined)).toBeUndefined();
    expect(parseStarted('')).toBeUndefined();
  });

  it('carriesTheStartTimeAndFolder_intoTheSample', () => {
    const [process]: readonly ProcessSample[] = readProcesses(
      [{ ...stat(50, 1), started: '2026-11-13 19:09:29', path: '/usr/bin' }],
      [],
      MACHINE,
      10,
    );

    expect(process.startedAt).toBe(new Date(2026, 10, 13, 19, 9, 29).getTime());
    expect(process.location).toBe('/usr/bin');
  });
});
