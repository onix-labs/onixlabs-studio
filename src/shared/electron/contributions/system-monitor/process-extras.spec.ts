import { describe, expect, it } from 'vitest';
import {
  joinDarwinExtras,
  parseDarwinThreads,
  parseDarwinTimes,
  parseProcStat,
  parsePsTime,
  parseWindowsProcesses,
  ProcessExtras,
} from './process-extras';

describe('parsePsTime', () => {
  it.each<[string, number]>([
    ['0:00.19', 0.19],
    ['39:43.37', 39 * 60 + 43.37],
    // macOS lets minutes run past 59.
    ['134:05.00', 134 * 60 + 5],
    ['01:02:03', 3723],
    ['2-01:02:03', 2 * 86_400 + 3723],
  ])('%s is %d seconds', (text: string, seconds: number) => {
    expect(parsePsTime(text)).toBeCloseTo(seconds, 5);
  });

  it('isUndefined_forSomethingElse', () => {
    expect(parsePsTime('-')).toBeUndefined();
  });
});

describe('macOS', () => {
  it('readsEachProcessesCpuTime', () => {
    const times: ReadonlyMap<number, number> = parseDarwinTimes(
      '    1   4:24.09\n  202  39:43.37\n  bad\n',
    );

    expect(times.get(1)).toBeCloseTo(264.09, 5);
    expect(times.get(202)).toBeCloseTo(2383.37, 5);
    expect(times.size).toBe(2);
  });

  it('countsEachProcessesThreads_fromItsLinesInTheThreadListing', () => {
    const output: string = [
      'USER               PID   TT   %CPU STAT PRI     STIME     UTIME COMMAND',
      'root                 1   ??    0.0 S    31T   0:00.03   0:00.01 /sbin/launchd',
      '                     1         0.0 S    20T   0:00.04   0:00.05 ',
      '                     1         1.2 S    37T   0:00.14   0:00.03 ',
      '_windowserver      202   ??    0.0 S    31T   0:00.00   0:00.00 /System/WindowServer',
      '                   202         0.1 S    20T   0:00.21   0:00.24 ',
    ].join('\n');

    const threads: ReadonlyMap<number, number> = parseDarwinThreads(output);

    expect(threads.get(1)).toBe(3);
    expect(threads.get(202)).toBe(2);
  });

  it('joinsTheTwoReadings', () => {
    expect(
      Object.fromEntries(
        joinDarwinExtras(
          new Map<number, number>([[1, 10]]),
          new Map<number, number>([
            [1, 3],
            [2, 1],
          ]),
        ),
      ),
    ).toEqual({ 1: { threads: 3, cpuTimeSeconds: 10 }, 2: { threads: 1 } });
  });
});

describe('parseProcStat', () => {
  it('readsThreadsAndCpuTime_countingFieldsFromAfterTheName', () => {
    // A name with a space and a parenthesis, which a naive split would misread.
    const stat: string =
      '4242 (my (odd) proc) S 1 4242 4242 0 -1 4194560 100 0 0 0 250 150 0 0 20 0 7 0 12345 1000000 200';

    expect(parseProcStat(stat)).toEqual({ threads: 7, cpuTimeSeconds: 4 });
  });

  it('isUndefined_forSomethingElse', () => {
    expect(parseProcStat('nonsense')).toBeUndefined();
  });
});

describe('parseWindowsProcesses', () => {
  it('readsThreadsAndCpuTime_inHundredsOfNanoseconds', () => {
    const extras: ReadonlyMap<number, ProcessExtras> = parseWindowsProcesses([
      { ProcessId: 4, ThreadCount: 120, UserModeTime: 0, KernelModeTime: 50_000_000 },
      { ProcessId: 900, ThreadCount: 12, UserModeTime: '20000000', KernelModeTime: '10000000' },
      { ThreadCount: 1 },
    ]);

    expect(Object.fromEntries(extras)).toEqual({
      4: { threads: 120, cpuTimeSeconds: 5 },
      900: { threads: 12, cpuTimeSeconds: 3 },
    });
  });

  it('acceptsTheSingleObjectConvertToJsonWritesForOneProcess', () => {
    expect(parseWindowsProcesses({ ProcessId: 4, ThreadCount: 2 }).get(4)).toEqual({ threads: 2 });
  });
});
