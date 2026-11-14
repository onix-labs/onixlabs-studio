import { ProcessSample, StudioProcessKind } from '@shared/api/system-monitor-channels';

/**
 * The subset of a `systeminformation` process this reads (`si.processes().list`). Structural, so the
 * contribution passes the listing straight in without this module importing `systeminformation`.
 */
export interface ProcessStat {
  readonly pid: number;
  readonly parentPid?: number;
  readonly name: string;
  readonly command?: string;
  readonly params?: string;
  readonly user?: string;
  readonly cpu: number;
  /**
   * Gets the resident memory, in kilobytes.
   */
  readonly memRss: number;
}

/**
 * The subset of an Electron process metric this reads (`app.getAppMetrics()`): which of Electron's
 * processes a pid is.
 */
export interface ElectronProcess {
  readonly pid: number;
  readonly type: string;
}

/**
 * Describes the machine the listing was taken on, which the readings are scaled against.
 */
export interface ProcessMachine {
  /**
   * Gets the main process's pid, the root of Studio's own process tree.
   */
  readonly mainPid: number;

  /**
   * Gets the number of logical cores.
   */
  readonly coreCount: number;

  /**
   * Gets the total physical memory, in bytes.
   */
  readonly totalBytes: number;

  /**
   * Gets whether the listing's CPU readings are per core (`ps`'s `%cpu`, as on macOS, where a process
   * busy on two cores reads 200) rather than a share of the whole machine (as systeminformation reports
   * on Linux and Windows).
   */
  readonly cpuIsPerCore: boolean;
}

/**
 * The tools the monitor itself runs to take its readings. One the main process started is the
 * listing reading itself, not something the user is running, so it is left out of the listing.
 */
const MONITOR_TOOLS: ReadonlySet<string> = new Set<string>([
  'ps',
  'ioreg',
  'sysctl',
  'df',
  'lsof',
  'netstat',
  'system_profiler',
  'powershell',
  'powershell.exe',
  'wmic',
  'wmic.exe',
]);

/**
 * Rounds a value to one decimal place.
 * @param value The value to round.
 * @returns Returns the rounded value.
 */
function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Clamps a value to the 0–100 range, treating anything not finite as 0.
 * @param value The value to clamp.
 * @returns Returns the clamped value.
 */
function clampPercent(value: number): number {
  return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0;
}

/**
 * Maps one of Electron's process types to the kind of Studio process it is.
 * @param type The Electron process type (`Browser`, `Tab`, `GPU`, `Utility` and so on).
 * @returns Returns the Studio process kind.
 */
function electronKind(type: string): StudioProcessKind {
  switch (type) {
    case 'Browser':
      return 'main';
    case 'Tab':
      return 'renderer';
    case 'GPU':
      return 'gpu';
    default:
      return 'utility';
  }
}

/**
 * Works out which processes are Studio's: Electron's own, by pid, and every process descended from the
 * main process — the shells, language servers, agents and builds Studio started, and whatever those
 * started in turn.
 * @param stats The processes listed.
 * @param electron Electron's own processes.
 * @param mainPid The main process's pid.
 * @returns Returns each of Studio's pids with its kind.
 */
export function studioProcesses(
  stats: readonly ProcessStat[],
  electron: readonly ElectronProcess[],
  mainPid: number,
): ReadonlyMap<number, StudioProcessKind> {
  const kinds: Map<number, StudioProcessKind> = new Map<number, StudioProcessKind>();
  for (const process of electron) {
    kinds.set(process.pid, electronKind(process.type));
  }
  if (!kinds.has(mainPid)) {
    kinds.set(mainPid, 'main');
  }

  const children: Map<number, number[]> = new Map<number, number[]>();
  for (const stat of stats) {
    const parent: number = stat.parentPid ?? 0;
    if (parent > 0 && parent !== stat.pid) {
      children.set(parent, [...(children.get(parent) ?? []), stat.pid]);
    }
  }

  // Breadth-first from the main process; the visited set guards against a cycle in a racy listing
  // (a pid reused between the parent and child being read).
  const visited: Set<number> = new Set<number>([mainPid]);
  const queue: number[] = [mainPid];
  while (queue.length > 0) {
    const pid: number = queue.shift() ?? 0;
    for (const child of children.get(pid) ?? []) {
      if (!visited.has(child)) {
        visited.add(child);
        queue.push(child);
        if (!kinds.has(child)) {
          kinds.set(child, 'child');
        }
      }
    }
  }
  return kinds;
}

/**
 * Maps a process listing to the processes a snapshot carries: every one of Studio's, then the busiest
 * of the rest — by CPU, then by memory — up to the limit in all. The tools the monitor runs to take its
 * own readings (a `ps` the main process started) are left out. CPU is scaled to a share of the whole
 * machine whatever the platform reported, so it reads against the machine-wide CPU graph.
 * @param stats The processes listed (`si.processes().list`).
 * @param electron Electron's own processes (`app.getAppMetrics()`).
 * @param machine The machine the listing was taken on.
 * @param limit The most processes to carry.
 * @returns Returns the processes, busiest first.
 */
export function readProcesses(
  stats: readonly ProcessStat[],
  electron: readonly ElectronProcess[],
  machine: ProcessMachine,
  limit: number,
): readonly ProcessSample[] {
  const kinds: ReadonlyMap<number, StudioProcessKind> = studioProcesses(
    stats,
    electron,
    machine.mainPid,
  );
  const cores: number = Math.max(1, machine.coreCount);
  const own: (stat: ProcessStat) => boolean = (stat: ProcessStat): boolean =>
    stat.parentPid === machine.mainPid && MONITOR_TOOLS.has(stat.name.toLowerCase());
  const samples: ProcessSample[] = stats
    .filter((stat: ProcessStat): boolean => !own(stat))
    .map((stat: ProcessStat): ProcessSample => {
      const memoryBytes: number = Math.max(0, stat.memRss) * 1024;
      const command: string = [stat.command, stat.params]
        .filter((part: string | undefined): boolean => part !== undefined && part.length > 0)
        .join(' ');
      const kind: StudioProcessKind | undefined = kinds.get(stat.pid);
      return {
        pid: stat.pid,
        parentPid: stat.parentPid ?? 0,
        name: stat.name,
        command: command.length > 0 ? command : stat.name,
        user: stat.user ?? '',
        cpuPercent: round1(clampPercent(machine.cpuIsPerCore ? stat.cpu / cores : stat.cpu)),
        memoryBytes,
        memoryPercent:
          machine.totalBytes > 0
            ? round1(clampPercent((memoryBytes / machine.totalBytes) * 100))
            : 0,
        ...(kind === undefined ? {} : { studio: kind }),
      };
    });

  const busiest: (a: ProcessSample, b: ProcessSample) => number = (
    a: ProcessSample,
    b: ProcessSample,
  ): number => b.cpuPercent - a.cpuPercent || b.memoryBytes - a.memoryBytes || a.pid - b.pid;
  const studio: ProcessSample[] = samples.filter(
    (sample: ProcessSample): boolean => sample.studio !== undefined,
  );
  const others: ProcessSample[] = samples
    .filter((sample: ProcessSample): boolean => sample.studio === undefined)
    .sort(busiest)
    .slice(0, Math.max(0, limit - studio.length));
  return [...studio, ...others].sort(busiest);
}
