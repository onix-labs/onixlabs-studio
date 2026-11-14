/**
 * Describes what a process listing does not carry: a process's threads and the CPU time it has used.
 */
export interface ProcessExtras {
  /**
   * Gets the number of threads, or undefined when unknown.
   */
  readonly threads?: number;

  /**
   * Gets the CPU time used since the process started, in seconds, or undefined when unknown.
   */
  readonly cpuTimeSeconds?: number;
}

/**
 * The subset of a Windows `Win32_Process` this reads, as `ConvertTo-Json` writes it.
 */
export interface WindowsProcess {
  readonly ProcessId?: number;
  readonly ThreadCount?: number | null;
  readonly UserModeTime?: number | string | null;
  readonly KernelModeTime?: number | string | null;
}

/**
 * The clock ticks a second in `/proc/<pid>/stat`'s times. Linux has fixed `USER_HZ` at 100 on every
 * architecture it ships for.
 */
const LINUX_CLOCK_TICKS: number = 100;

/**
 * Parses a `ps` CPU time: `[[dd-]hh:]mm:ss[.ss]` (Linux and the BSDs) or `mmm:ss.ss` (macOS, whose
 * minutes run past 59).
 * @param text The time as `ps` writes it.
 * @returns Returns the time in seconds, or undefined when it does not parse.
 */
export function parsePsTime(text: string): number | undefined {
  const match: RegExpExecArray | null = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/.exec(
    text.trim(),
  );
  if (match === null) {
    return undefined;
  }
  const days: number = Number(match[1] ?? 0);
  const hours: number = Number(match[2] ?? 0);
  return days * 86_400 + hours * 3600 + Number(match[3]) * 60 + Number(match[4]);
}

/**
 * Parses macOS's `ps -axo pid=,time=`: each process's CPU time.
 * @param output The command's output.
 * @returns Returns each process's CPU time in seconds, by pid.
 */
export function parseDarwinTimes(output: string): ReadonlyMap<number, number> {
  const times: Map<number, number> = new Map<number, number>();
  for (const line of output.split('\n')) {
    const [pid, time]: string[] = line.trim().split(/\s+/);
    const seconds: number | undefined = time === undefined ? undefined : parsePsTime(time);
    if (pid !== undefined && /^\d+$/.test(pid) && seconds !== undefined) {
      times.set(Number(pid), seconds);
    }
  }
  return times;
}

/**
 * Parses macOS's `ps -axM`: one line per thread, the process's first carrying its user before the pid,
 * the rest a blank user. Counting the lines per pid counts its threads.
 * @param output The command's output.
 * @returns Returns each process's thread count, by pid.
 */
export function parseDarwinThreads(output: string): ReadonlyMap<number, number> {
  const threads: Map<number, number> = new Map<number, number>();
  for (const line of output.split('\n').slice(1)) {
    const fields: string[] = line.trim().split(/\s+/);
    // A process's first line is `user pid …`; its other threads' are `pid …`.
    const pid: string | undefined = /^\d+$/.test(fields[0] ?? '') ? fields[0] : fields[1];
    if (pid !== undefined && /^\d+$/.test(pid)) {
      threads.set(Number(pid), (threads.get(Number(pid)) ?? 0) + 1);
    }
  }
  return threads;
}

/**
 * Parses a Linux `/proc/<pid>/stat`: the process's threads (field 20) and CPU time (fields 14 and 15,
 * user and system, in clock ticks). The command name (field 2) is parenthesised and may hold spaces
 * or parentheses, so the fields are counted from after its last `)`.
 * @param stat The file's content.
 * @returns Returns the extras, or undefined when it does not parse.
 */
export function parseProcStat(stat: string): ProcessExtras | undefined {
  const close: number = stat.lastIndexOf(')');
  if (close < 0) {
    return undefined;
  }
  // After the name, fields run from 3 (state); field n is at index n - 3.
  const fields: string[] = stat
    .slice(close + 1)
    .trim()
    .split(/\s+/);
  const utime: number = Number(fields[14 - 3]);
  const stime: number = Number(fields[15 - 3]);
  const threads: number = Number(fields[20 - 3]);
  if (![utime, stime, threads].every((value: number): boolean => Number.isFinite(value))) {
    return undefined;
  }
  return { threads, cpuTimeSeconds: (utime + stime) / LINUX_CLOCK_TICKS };
}

/**
 * Parses Windows' `Win32_Process` listing: each process's threads and CPU time (user and kernel, in
 * 100-nanosecond units).
 * @param processes The processes, as `ConvertTo-Json` writes them (one object for a single process).
 * @returns Returns each process's extras, by pid.
 */
export function parseWindowsProcesses(
  processes: WindowsProcess | readonly WindowsProcess[],
): ReadonlyMap<number, ProcessExtras> {
  const extras: Map<number, ProcessExtras> = new Map<number, ProcessExtras>();
  const list: readonly WindowsProcess[] = Array.isArray(processes) ? processes : [processes];
  for (const process of list) {
    if (typeof process.ProcessId !== 'number') {
      continue;
    }
    const user: number = Number(process.UserModeTime ?? Number.NaN);
    const kernel: number = Number(process.KernelModeTime ?? Number.NaN);
    extras.set(process.ProcessId, {
      ...(typeof process.ThreadCount === 'number' ? { threads: process.ThreadCount } : {}),
      ...(Number.isFinite(user) && Number.isFinite(kernel)
        ? { cpuTimeSeconds: (user + kernel) / 1e7 }
        : {}),
    });
  }
  return extras;
}

/**
 * Joins macOS's two readings into each process's extras.
 * @param times Each process's CPU time, by pid.
 * @param threads Each process's thread count, by pid.
 * @returns Returns each process's extras, by pid.
 */
export function joinDarwinExtras(
  times: ReadonlyMap<number, number>,
  threads: ReadonlyMap<number, number>,
): ReadonlyMap<number, ProcessExtras> {
  const extras: Map<number, ProcessExtras> = new Map<number, ProcessExtras>();
  for (const pid of new Set<number>([...times.keys(), ...threads.keys()])) {
    const time: number | undefined = times.get(pid);
    const count: number | undefined = threads.get(pid);
    extras.set(pid, {
      ...(count === undefined ? {} : { threads: count }),
      ...(time === undefined ? {} : { cpuTimeSeconds: time }),
    });
  }
  return extras;
}
